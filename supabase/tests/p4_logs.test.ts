import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./db";

const U = "00000000-0000-0000-0000-00000000a001";
const X = "00000000-0000-0000-0000-00000000a002";
let db: PGlite;
let farm: string;
let plan: string;
let planting: string;

async function one<T>(user: string, sql: string, params: unknown[] = []) {
  return (await asUser<T>(db, user, sql, params))[0];
}

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, U);
  await createUser(db, X);
  farm = (await one<{ id: string }>(U, "select create_farm('밭', 37, 127) as id")).id;
  const crops = (
    await db.query<{ id: string; name: string }>(
      "insert into crops (name, status, plants_per_pyeong) values ('상추', 'confirmed', 110), ('바질', 'confirmed', null) returning id, name",
    )
  ).rows;
  const lettuce = crops.find((c) => c.name === "상추")!.id;
  const basil = crops.find((c) => c.name === "바질")!.id;
  plan = (await one<{ id: string }>(U, "select create_plan($1, 2026, 'spring') as id", [farm])).id;
  for (let x = 0; x < 6; x++) {
    await asUser(db, U, "insert into field_plan_cells (plan_id, x, y, crop_id, companion_crop_id) values ($1, $2, 0, $3, $4)", [
      plan,
      x,
      lettuce,
      x === 0 ? basil : null,
    ]);
  }
  await asUser(db, U, "select request_plan_confirmation($1)", [plan]);
  planting = (await db.query<{ id: string }>("select id from plantings where plan_id = $1", [plan])).rows[0].id;
});

describe("split_planting", () => {
  it("splits cells into staggered plantings and recomputes counts", async () => {
    const cells = (
      await db.query<{ id: string }>(
        "select c.id from planting_cells pc join field_plan_cells c on c.id = pc.cell_id where pc.planting_id = $1 order by c.x",
        [planting],
      )
    ).rows.map((r) => r.id);
    const [r] = await asUser<{ ids: string[] }>(db, U, "select split_planting($1, $2) as ids", [
      planting,
      JSON.stringify([cells.slice(0, 2), cells.slice(2, 4), cells.slice(4)]),
    ]);
    expect(r.ids).toHaveLength(3);
    const counts = await asUser<{ n: number; planned: number }>(
      db,
      U,
      "select count(pc.cell_id)::int as n, pl.planned_plant_count as planned from plantings pl join planting_cells pc on pc.planting_id = pl.id where pl.plan_id = $1 group by pl.id order by pl.created_at",
      [plan],
    );
    // 2칸 = 0.5㎡ → 0.5/3.3058×110 ≈ 17
    expect(counts).toEqual([
      { n: 2, planned: 17 },
      { n: 2, planned: 17 },
      { n: 2, planned: 17 },
    ]);
  });

  it("non-member cannot split", async () => {
    await expect(asUser(db, X, "select split_planting($1, '[]')", [planting])).rejects.toThrow(/not a farm member/);
  });
});

describe("complete_task", () => {
  it("turns a pending task into a work log for its crop", async () => {
    const [pc] = (await db.query<{ id: string }>("select plan_crop_id as id from plantings where id = $1", [planting])).rows;
    const [task] = await asUser<{ id: string }>(
      db,
      U,
      "insert into tasks (farm_id, planting_id, plan_crop_id, task_type, title, calculated_date) values ($1, $2, $3, 'top_dressing', '상추 1차 추비', '2026-05-01') returning id",
      [farm, planting, pc.id],
    );
    const [log] = await asUser<{ id: string }>(db, U, "select complete_task($1, '2026-05-02') as id", [task.id]);
    const row = await one<{ work_type: string; work_date: string; memo: string; created_by: string }>(
      U,
      "select work_type, work_date::text, memo, created_by from work_logs where id = $1",
      [log.id],
    );
    expect(row).toEqual({ work_type: "top_dressing", work_date: "2026-05-02", memo: "상추 1차 추비", created_by: U });
    const targets = await asUser(db, U, "select 1 from work_log_targets where work_log_id = $1 and plan_crop_id = $2", [log.id, pc.id]);
    expect(targets).toHaveLength(1);
    const t = await one<{ status: string }>(U, "select status from tasks where id = $1", [task.id]);
    expect(t.status).toBe("done");
    await expect(asUser(db, U, "select complete_task($1, '2026-05-02')", [task.id])).rejects.toThrow(/task_not_pending/);
  });
});

describe("realtime", () => {
  it("publishes tasks and work_logs for the dashboard", async () => {
    const { rows } = await db.query<{ tablename: string }>(
      "select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename",
    );
    expect(rows.map((r) => r.tablename)).toEqual(["tasks", "work_logs"]);
  });
});

describe("active_plan_crops", () => {
  it("lists main crops with active plantings and companions following them", async () => {
    const rows = await asUser<{ crop_name: string; is_companion: boolean }>(
      db,
      U,
      "select crop_name, is_companion from active_plan_crops order by crop_name",
    );
    expect(rows).toEqual([
      { crop_name: "바질", is_companion: true },
      { crop_name: "상추", is_companion: false },
    ]);
    // 상추 식재를 모두 종료하면 사이작물도 빠진다
    const ids = (await db.query<{ id: string }>("select id from plantings where plan_id = $1", [plan])).rows;
    for (const { id } of ids) await asUser(db, U, "select end_planting($1, '2026-07-01')", [id]);
    expect(await asUser(db, U, "select * from active_plan_crops")).toEqual([]);
    expect(await asUser(db, X, "select * from active_plan_crops")).toEqual([]);
  });
});
