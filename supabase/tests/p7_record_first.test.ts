import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./db";

const U = "00000000-0000-0000-0000-0000000000c1";
const X = "00000000-0000-0000-0000-0000000000c2";

let db: PGlite;
let farm: string;
let bed: string;
const crop: Record<string, string> = {};

async function one<T>(user: string, sql: string, params: unknown[] = []) {
  return (await asUser<T>(db, user, sql, params))[0];
}

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, U);
  await createUser(db, X);
  farm = (await one<{ id: string }>(U, "select create_farm('기록밭', 37.6, 126.7) as id")).id;
  const fam = (await db.query<{ id: string }>("insert into crop_families (name, status) values ('십자화과', 'confirmed') on conflict (name) do update set name = excluded.name returning id")).rows[0].id;
  for (const name of ["돌산갓", "배추"]) {
    crop[name] = (await db.query<{ id: string }>("insert into crops (name, family_id, status, sow_method, plant_spacing_cm) values ($1, $2, 'confirmed', 'direct', 25) returning id", [name, fam])).rows[0].id;
  }
  bed = (await one<{ id: string }>(U, "insert into field_beds (farm_id, kind, x_cm, y_cm, w_cm, h_cm) values ($1, 'bed', 0, 0, 100, 300) returning id", [farm])).id;
});

describe("record first, place later", () => {
  it("season_of follows the app's season rule", async () => {
    const rows = await db.query<{ d: string; year: number; season: string }>(
      "select d::text, s.year, s.season from unnest(array['2026-03-01','2026-09-15','2026-12-05','2027-02-10']::date[]) d, season_of(d) s",
    );
    expect(rows.rows.map((r) => `${r.year}-${r.season}`)).toEqual(["2026-spring", "2026-autumn", "2026-overwinter", "2026-overwinter"]);
  });

  let planting: string;
  it("recording a sowing creates a confirmed season plan and an unplaced planting", async () => {
    planting = (await one<{ id: string }>(U, "select record_planting($1, $2, '2026-09-20', 'direct') as id", [farm, crop["돌산갓"]])).id;
    const row = await one<{ status: string; season: string; sow_date: string; bed_planting_id: string | null }>(
      U,
      "select p.status, p.season, pl.sow_date::text, pl.bed_planting_id from plantings pl join field_plans p on p.id = pl.plan_id where pl.id = $1",
      [planting],
    );
    expect(row).toEqual({ status: "confirmed", season: "autumn", sow_date: "2026-09-20", bed_planting_id: null });
    await expect(asUser(db, X, "select record_planting($1, $2, '2026-09-20', 'direct')", [farm, crop["배추"]])).rejects.toThrow(/not a farm member/);
  });

  it("places the planting on a bed and moves it later", async () => {
    await asUser(db, U, "select place_planting($1, $2, 3, 'parallel', 'row', 0, 150)", [planting, bed]);
    const placed = await one<{ cells: number; method: string; rows: number }>(
      U,
      `select (select count(*)::int from planting_cells where planting_id = pl.id) as cells, bp.method, bp.rows
       from plantings pl join plan_bed_plantings bp on bp.id = pl.bed_planting_id where pl.id = $1`,
      [planting],
    );
    // 100×150cm, 0.5m 칸 → 2×3칸
    expect(placed).toEqual({ cells: 6, method: "row", rows: 3 });

    await asUser(db, U, "select place_planting($1, $2, 3, 'parallel', 'row', 150, null)", [planting, bed]);
    const moved = await one<{ ys: number[]; total: number }>(
      U,
      `select array_agg(distinct fc.y order by fc.y) as ys,
              (select count(*)::int from field_plan_cells where plan_id = pl.plan_id) as total
       from plantings pl join planting_cells pc on pc.planting_id = pl.id join field_plan_cells fc on fc.id = pc.cell_id
       where pl.id = $1 group by pl.plan_id`,
      [planting],
    );
    expect(moved).toEqual({ ys: [3, 4, 5], total: 6 });
  });

  it("fills in the date of a planting that was planned first", async () => {
    const other = (await one<{ id: string }>(U, "select record_planting($1, $2, '2026-09-01', 'direct') as id", [farm, crop["배추"]])).id;
    await asUser(db, U, "select record_planting($1, $2, '2026-09-03', 'transplant', 5, $3)", [farm, crop["배추"], other]);
    const row = await one<{ sow_date: string | null; transplant_date: string; plant_count: number }>(
      U,
      "select sow_date::text, transplant_date::text, plant_count from plantings where id = $1",
      [other],
    );
    expect(row).toEqual({ sow_date: null, transplant_date: "2026-09-03", plant_count: 5 });
  });

  it("refuses to record into a season whose plan is still a draft", async () => {
    await asUser(db, U, "select create_plan($1, 2027, 'spring')", [farm]);
    await expect(asUser(db, U, "select record_planting($1, $2, '2027-04-01', 'direct')", [farm, crop["배추"]])).rejects.toThrow(/plan_not_confirmed/);
  });
});
