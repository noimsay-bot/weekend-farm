import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./db";

const U = "00000000-0000-0000-0000-0000000000b1";
const X = "00000000-0000-0000-0000-0000000000b2";

let db: PGlite;
let farm: string;
let plan: string;
const crop: Record<string, string> = {};
const bed: Record<string, string> = {};

async function one<T>(user: string, sql: string, params: unknown[] = []) {
  return (await asUser<T>(db, user, sql, params))[0];
}

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, U);
  await createUser(db, X);
  farm = (await one<{ id: string }>(U, "select create_farm('구획밭', 37.5, 127) as id")).id;
  // 0.5m 칸
  for (const [name, family] of [
    ["무", "십자화과"],
    ["양배추", "십자화과"],
    ["배추", "십자화과"],
  ]) {
    const fam = (await db.query<{ id: string }>("insert into crop_families (name, status) values ($1, 'confirmed') on conflict (name) do update set name = excluded.name returning id", [family])).rows[0].id;
    crop[name] = (await db.query<{ id: string }>("insert into crops (name, family_id, status, sow_method, plant_spacing_cm) values ($1, $2, 'confirmed', 'direct', 25) returning id", [name, fam])).rows[0].id;
  }
  // 세로 두둑(무), 가로 두둑(양배추), 네모 밭(배추)
  const add = async (key: string, kind: string, x: number, y: number, w: number, h: number) =>
    (bed[key] = (await one<{ id: string }>(U, "insert into field_beds (farm_id, kind, x_cm, y_cm, w_cm, h_cm) values ($1, $2, $3, $4, $5, $6) returning id", [farm, kind, x, y, w, h])).id);
  await add("세로", "bed", 0, 200, 100, 300);
  await add("가로", "bed", 0, 100, 300, 50);
  await add("네모", "plot", 200, 0, 100, 100);
  plan = (await one<{ id: string }>(U, "select create_plan($1, 2026, 'autumn') as id", [farm])).id;
});

describe("field beds", () => {
  it("only farm members see and edit beds", async () => {
    expect(await asUser(db, X, "select id from field_beds where farm_id = $1", [farm])).toEqual([]);
    await expect(
      asUser(db, X, "insert into field_beds (farm_id, x_cm, y_cm, w_cm, h_cm) values ($1, 0, 0, 50, 50)", [farm]),
    ).rejects.toThrow();
  });

  it("syncs location cells from bed plantings (vertical, horizontal segment, small plot)", async () => {
    const ins = "insert into plan_bed_plantings (plan_id, bed_id, crop_id, rows, start_cm, length_cm, plant_count) values ($1, $2, $3, $4, $5, $6, $7)";
    await asUser(db, U, ins, [plan, bed["세로"], crop["무"], 2, 0, null, null]);
    await asUser(db, U, ins, [plan, bed["가로"], crop["양배추"], 1, 100, 100, 3]);
    await asUser(db, U, ins, [plan, bed["네모"], crop["배추"], 1, 0, null, 5]);
    await asUser(db, U, "update plan_bed_plantings set layout = 'staggered' where bed_id = $1", [bed["세로"]]);
    await expect(asUser(db, U, "update plan_bed_plantings set layout = 'diagonal' where bed_id = $1", [bed["세로"]])).rejects.toThrow();
    await asUser(db, U, "select sync_plan_bed_cells($1)", [plan]);
    const bpId = (await asUser<{ id: string }>(db, U, "select id from plan_bed_plantings where bed_id = $1", [bed["세로"]]))[0].id;
    await asUser(db, U, "update plan_bed_plantings set method = 'row' where id = $1", [bpId]);
    const sown = await db.query<{ n: number | null }>("select bed_planting_auto_count($1) as n", [bpId]);
    expect(sown.rows[0].n).toBeNull();
    await asUser(db, U, "update plan_bed_plantings set method = 'hill' where id = $1", [bpId]);
    // 엇갈려 두 줄(300cm, 포기 간격 25cm): 줄마다 50cm 간격 → 2 × 6 = 12 (나란히면 24)
    const staggered = await db.query<{ n: number }>("select bed_planting_auto_count($1) as n", [bpId]);
    expect(staggered.rows[0].n).toBe(12);
    const cells = await asUser<{ x: number; y: number; name: string }>(
      db,
      U,
      "select c.x, c.y, cr.name from field_plan_cells c join crops cr on cr.id = c.crop_id where c.plan_id = $1 order by cr.name, c.y, c.x",
      [plan],
    );
    const by = (n: string) => cells.filter((c) => c.name === n).map((c) => `${c.x},${c.y}`);
    // 세로 두둑 100×300cm → 2×6칸 (y 4~9)
    expect(by("무")).toHaveLength(12);
    expect(by("무")).toContain("0,4");
    expect(by("무")).toContain("1,9");
    // 가로 두둑 x 100~200cm 구간 → x 2,3 / y 2 (두둑 폭 50cm의 중심 칸)
    expect(by("양배추")).toEqual(["2,2", "3,2"]);
    expect(by("배추")).toEqual(["4,0", "5,0", "4,1", "5,1"]);
  });

  it("finalize creates one planting per bed planting with its plant count", async () => {
    await asUser(db, U, "select request_plan_confirmation($1)", [plan]);
    const rows = await asUser<{ name: string; planned_plant_count: number; cells: number; linked: boolean }>(
      db,
      U,
      `select cr.name, pl.planned_plant_count, (select count(*)::int from planting_cells pc where pc.planting_id = pl.id) as cells,
              pl.bed_planting_id is not null as linked
       from plantings pl join crops cr on cr.id = pl.crop_id where pl.plan_id = $1 order by cr.name`,
      [plan],
    );
    expect(rows).toEqual([
      { name: "무", planned_plant_count: 12, cells: 12, linked: true }, // 엇갈려 두 줄이라 나란히(24)의 절반
      { name: "배추", planned_plant_count: 5, cells: 4, linked: true },
      { name: "양배추", planned_plant_count: 3, cells: 2, linked: true },
    ]);
  });

  it("confirmed plans lock bed plantings, and a copied plan reuses them", async () => {
    await expect(asUser(db, U, "update plan_bed_plantings set rows = 3 where plan_id = $1", [plan])).rejects.toThrow(/plan_confirmed/);
    const next = (await one<{ id: string }>(U, "select create_plan($1, 2027, 'spring', $2) as id", [farm, plan])).id;
    const copied = await asUser<{ n: number }>(db, U, "select count(*)::int as n from plan_bed_plantings where plan_id = $1", [next]);
    expect(copied[0].n).toBe(3);
    const staggered = await asUser<{ n: number }>(db, U, "select count(*)::int as n from plan_bed_plantings where plan_id = $1 and layout = 'staggered'", [next]);
    expect(staggered[0].n).toBe(1);
    const cells = await asUser<{ n: number }>(db, U, "select count(*)::int as n from field_plan_cells where plan_id = $1", [next]);
    expect(cells[0].n).toBe(18);
  });
});
