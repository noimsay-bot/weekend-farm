import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./db";

const A = "00000000-0000-0000-0000-0000000000f1";
const B = "00000000-0000-0000-0000-0000000000f2";
const SOLO = "00000000-0000-0000-0000-0000000000f3";

let db: PGlite;
let farm: string; // A, B 공동 농장
let soloFarm: string;
const crop: Record<string, string> = {};

async function one<T>(user: string, sql: string, params: unknown[] = []) {
  return (await asUser<T>(db, user, sql, params))[0];
}

async function addCrop(name: string, family: string, extra: Record<string, unknown>) {
  const [fam] = (
    await db.query<{ id: string }>(
      "insert into crop_families (name, status) values ($1, 'confirmed') on conflict (name) do update set name = excluded.name returning id",
      [family],
    )
  ).rows;
  const cols = ["name", "family_id", "status", ...Object.keys(extra)];
  const vals = [name, fam.id, "confirmed", ...Object.values(extra)];
  const [c] = (
    await db.query<{ id: string }>(
      `insert into crops (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
      vals,
    )
  ).rows;
  crop[name] = c.id;
}

async function newPlan(user: string, farmId: string, year: number, season: string, copyFrom: string | null = null, keep: string[] = []) {
  return (
    await one<{ id: string }>(user, "select create_plan($1, $2, $3, $4, $5) as id", [farmId, year, season, copyFrom, keep])
  ).id;
}

async function paint(user: string, planId: string, cells: [number, number, string, string?][]) {
  for (const [x, y, name, companion] of cells) {
    await asUser(
      db,
      user,
      "insert into field_plan_cells (plan_id, x, y, crop_id, companion_crop_id) values ($1, $2, $3, $4, $5) on conflict (plan_id, x, y) do update set crop_id = excluded.crop_id, companion_crop_id = excluded.companion_crop_id",
      [planId, x, y, crop[name], companion ? crop[companion] : null],
    );
  }
}

async function status(planId: string) {
  return (await db.query<{ status: string }>("select status from field_plans where id = $1", [planId])).rows[0].status;
}

beforeAll(async () => {
  db = await createTestDb();
  for (const u of [A, B, SOLO]) await createUser(db, u);
  farm = (await one<{ id: string }>(A, "select create_farm('공동밭', 37.6, 126.7) as id")).id;
  const token = (await one<{ t: string }>(A, "select create_farm_invite($1) as t", [farm])).t;
  await asUser(db, B, "select accept_farm_invite($1)", [token]);
  soloFarm = (await one<{ id: string }>(SOLO, "select create_farm('혼자밭', 37, 127) as id")).id;

  await addCrop("배추", "십자화과", { rotation_risk: "high", rest_seasons: 2, plants_per_pyeong: 9, sow_method: "transplant" });
  await addCrop("무", "십자화과", { rotation_risk: "high", rest_seasons: 2, plants_per_pyeong: 20, sow_method: "direct" });
  await addCrop("상추", "국화과", { rotation_risk: "low", plants_per_pyeong: 110 });
  await addCrop("바질", "꿀풀과", { rotation_risk: "low" });
  await addCrop("마늘", "백합과", { season: "overwinter", overwinter_default: "keep", rotation_risk: "low" });
  await addCrop("아스파라거스", "백합과", { season: "perennial", rotation_risk: "low" });
});

describe("confirmation", () => {
  it("single member confirms immediately and builds plan crops and plantings", async () => {
    const plan = await newPlan(SOLO, soloFarm, 2026, "autumn");
    // 배추 두 덩어리 (0,0)(1,0) / (3,0), 상추 칸에 바질 사이작물
    await paint(SOLO, plan, [
      [0, 0, "배추"],
      [1, 0, "배추"],
      [3, 0, "배추"],
      [0, 1, "상추", "바질"],
    ]);
    const [r] = await asUser<{ s: string }>(db, SOLO, "select request_plan_confirmation($1) as s", [plan]);
    expect(r.s).toBe("confirmed");

    const crops = await asUser<{ name: string; is_companion: boolean }>(
      db,
      SOLO,
      "select c.name, pc.is_companion from plan_crops pc join crops c on c.id = pc.crop_id where plan_id = $1 order by c.name",
      [plan],
    );
    expect(crops).toEqual([
      { name: "바질", is_companion: true },
      { name: "배추", is_companion: false },
      { name: "상추", is_companion: false },
    ]);

    // 사이작물은 식재·포기 수 계산에서 제외. 칸 0.5m → 2칸 = 0.5㎡ → 0.5/3.3058*9 ≈ 1
    const plantings = await asUser<{ name: string; cells: number; planned_plant_count: number }>(
      db,
      SOLO,
      `select c.name, count(pc.cell_id)::int as cells, pl.planned_plant_count
       from plantings pl join crops c on c.id = pl.crop_id join planting_cells pc on pc.planting_id = pl.id
       where pl.plan_id = $1 group by pl.id, c.name order by c.name, cells desc`,
      [plan],
    );
    expect(plantings).toEqual([
      { name: "배추", cells: 2, planned_plant_count: 1 },
      { name: "배추", cells: 1, planned_plant_count: 1 },
      { name: "상추", cells: 1, planned_plant_count: 8 },
    ]);
  });

  it("two members: pending until both approve; editing resets approvals", async () => {
    const plan = await newPlan(A, farm, 2026, "spring");
    await paint(A, plan, [[0, 0, "상추"]]);
    const [r] = await asUser<{ s: string }>(db, A, "select request_plan_confirmation($1) as s", [plan]);
    expect(r.s).toBe("pending_approval");

    const events = await asUser<{ recipient_id: string; type: string }>(
      db,
      B,
      "select recipient_id, type from notification_events where farm_id = $1",
      [farm],
    );
    expect(events).toEqual([{ recipient_id: B, type: "plan_approval" }]);

    // 대기 중 수정 → 초안, 확정 초기화
    await paint(B, plan, [[1, 0, "상추"]]);
    expect(await status(plan)).toBe("draft");
    expect((await db.query("select * from field_plan_approvals where plan_id = $1", [plan])).rows).toEqual([]);

    await asUser(db, A, "select request_plan_confirmation($1)", [plan]);
    const [again] = await asUser<{ s: string }>(db, B, "select approve_plan($1) as s", [plan]);
    expect(again.s).toBe("confirmed");
  });

  it("confirmed plan cells cannot be edited directly", async () => {
    const [plan] = (await db.query<{ id: string }>("select id from field_plans where farm_id = $1 and season = 'spring' and year = 2026", [farm])).rows;
    await expect(paint(A, plan.id, [[5, 5, "상추"]])).rejects.toThrow(/plan_confirmed/);
  });

  it("status cannot be changed without functions", async () => {
    const plan = await newPlan(A, farm, 2027, "autumn");
    await expect(asUser(db, A, "update field_plans set status = 'confirmed' where id = $1", [plan])).rejects.toThrow(
      /use plan functions/,
    );
    await expect(
      asUser(db, A, "insert into field_plans (farm_id, year, season, status) values ($1, 2030, 'spring', 'confirmed')", [farm]),
    ).rejects.toThrow(/start as draft/);
  });
});

describe("rotation warnings", () => {
  let farmR: string;
  const U = "00000000-0000-0000-0000-0000000000f9";

  beforeEach(async () => {
    await db.query("delete from farms where name = '연작밭'");
    await db.query("insert into auth.users (id) values ($1) on conflict do nothing", [U]);
    farmR = (await one<{ id: string }>(U, "select create_farm('연작밭', 37, 127) as id")).id;
  });

  async function confirmed(year: number, season: string, cells: [number, number, string][]) {
    const plan = await newPlan(U, farmR, year, season);
    await paint(U, plan, cells);
    await asUser(db, U, "select request_plan_confirmation($1)", [plan]);
    return plan;
  }

  it("warns when same high-risk family was in the cell within rest seasons", async () => {
    await confirmed(2025, "autumn", [[0, 0, "배추"], [1, 0, "상추"]]);
    const plan = await newPlan(U, farmR, 2026, "spring");
    await paint(U, plan, [[0, 0, "무"], [1, 0, "무"], [2, 0, "배추"]]);
    const w = await asUser<{ x: number; y: number; prev_year: number; prev_season: string }>(
      db,
      U,
      "select x, y, prev_year, prev_season from plan_rotation_warnings($1)",
      [plan],
    );
    expect(w).toEqual([{ x: 0, y: 0, prev_year: 2025, prev_season: "autumn" }]);

    await asUser(db, U, "select request_plan_confirmation($1)", [plan]);
    const flags = await asUser<{ x: number; rotation_flag: boolean }>(
      db,
      U,
      "select x, rotation_flag from field_plan_cells where plan_id = $1 order by x",
      [plan],
    );
    expect(flags.map((f) => f.rotation_flag)).toEqual([true, false, false]);
  });

  it("no warning beyond rest seasons", async () => {
    await confirmed(2025, "spring", [[0, 0, "배추"]]); // 3작기 전
    await confirmed(2025, "autumn", [[0, 0, "상추"]]);
    await confirmed(2025, "overwinter", [[0, 0, "상추"]]);
    const plan = await newPlan(U, farmR, 2026, "spring");
    await paint(U, plan, [[0, 0, "무"]]);
    expect(await asUser(db, U, "select * from plan_rotation_warnings($1)", [plan])).toEqual([]);
  });

  it("replaced crops count in rotation history", async () => {
    const prev = await confirmed(2025, "autumn", [[0, 0, "상추"]]);
    const [pl] = (await db.query<{ id: string }>("select id from plantings where plan_id = $1", [prev])).rows;
    await asUser(db, U, "select replace_planting($1, $2)", [pl.id, crop["배추"]]);
    await asUser(db, U, "select replace_planting((select id from plantings where plan_id = $1 and status = 'active'), $2)", [
      prev,
      crop["상추"],
    ]);
    const plan = await newPlan(U, farmR, 2026, "spring");
    await paint(U, plan, [[0, 0, "무"]]);
    const w = await asUser(db, U, "select x from plan_rotation_warnings($1)", [plan]);
    expect(w).toHaveLength(1);
  });
});

describe("carry over", () => {
  let farmC: string;
  const U = "00000000-0000-0000-0000-0000000000fa";
  let autumn: string;

  beforeAll(async () => {
    await createUser(db, U);
    farmC = (await one<{ id: string }>(U, "select create_farm('월동밭', 37, 127) as id")).id;
    autumn = await newPlan(U, farmC, 2025, "autumn");
    await paint(U, autumn, [[0, 0, "마늘"], [1, 0, "마늘"], [3, 3, "아스파라거스"], [5, 5, "배추"]]);
    await asUser(db, U, "select request_plan_confirmation($1)", [autumn]);
  });

  it("lists overwinter and perennial plantings as candidates", async () => {
    const c = await asUser<{ crop_name: string; overwinter_default: string | null; season: string }>(
      db,
      U,
      "select crop_name, overwinter_default, season from carry_over_candidates($1, 2026) order by crop_name",
      [farmC],
    );
    expect(c).toEqual([
      { crop_name: "마늘", overwinter_default: "keep", season: "overwinter" },
      { crop_name: "아스파라거스", overwinter_default: null, season: "perennial" },
    ]);
  });

  it("kept cells are locked, released by harvest; perennial only by ending", async () => {
    const [garlic] = (
      await db.query<{ id: string }>(
        "select pl.id from plantings pl join crops c on c.id = pl.crop_id where pl.plan_id = $1 and c.name = '마늘'",
        [autumn],
      )
    ).rows;
    const spring = await newPlan(U, farmC, 2026, "spring", autumn, [garlic.id]);

    const cells = await asUser<{ x: number; y: number; carry_state: string | null; name: string }>(
      db,
      U,
      "select c.x, c.y, c.carry_state, cr.name from field_plan_cells c join crops cr on cr.id = c.crop_id where plan_id = $1 order by y, x",
      [spring],
    );
    // 마늘·아스파라거스는 점유 유지, 배추는 복사된 일반 칸
    expect(cells).toEqual([
      { x: 0, y: 0, carry_state: "carried_occupied", name: "마늘" },
      { x: 1, y: 0, carry_state: "carried_occupied", name: "마늘" },
      { x: 3, y: 3, carry_state: "carried_occupied", name: "아스파라거스" },
      { x: 5, y: 5, carry_state: null, name: "배추" },
    ]);

    await expect(paint(U, spring, [[0, 0, "상추"]])).rejects.toThrow(/cell_locked/);

    // 마늘 수확 기록 → 해제
    const [pc] = (await db.query<{ id: string }>("select plan_crop_id as id from plantings where id = $1", [garlic.id])).rows;
    const [log] = await asUser<{ id: string }>(
      db,
      U,
      "insert into work_logs (farm_id, work_date, work_type, created_by) values ($1, '2026-06-10', 'harvest', $2) returning id",
      [farmC, U],
    );
    await asUser(db, U, "insert into work_log_targets (work_log_id, plan_crop_id) values ($1, $2)", [log.id, pc.id]);
    await paint(U, spring, [[0, 0, "상추"]]);

    // 아스파라거스는 수확으로 풀리지 않고 식재 종료로만 풀린다
    const [asp] = (
      await db.query<{ id: string; pc: string }>(
        "select pl.id, pl.plan_crop_id as pc from plantings pl join crops c on c.id = pl.crop_id where pl.plan_id = $1 and c.name = '아스파라거스'",
        [autumn],
      )
    ).rows;
    const [log2] = await asUser<{ id: string }>(
      db,
      U,
      "insert into work_logs (farm_id, work_date, work_type, created_by) values ($1, '2026-05-01', 'harvest', $2) returning id",
      [farmC, U],
    );
    await asUser(db, U, "insert into work_log_targets (work_log_id, plan_crop_id) values ($1, $2)", [log2.id, asp.pc]);
    await expect(paint(U, spring, [[3, 3, "상추"]])).rejects.toThrow(/cell_locked/);
    await asUser(db, U, "select end_planting($1, '2026-05-02')", [asp.id]);
    await paint(U, spring, [[3, 3, "상추"]]);
  });
});

describe("changes after confirmation", () => {
  it("replace by one member notifies others and updates cells", async () => {
    const plan = await newPlan(A, farm, 2026, "autumn");
    await paint(A, plan, [[0, 0, "배추"]]);
    await asUser(db, A, "select request_plan_confirmation($1)", [plan]);
    await asUser(db, B, "select approve_plan($1)", [plan]);
    const [pl] = (await db.query<{ id: string }>("select id from plantings where plan_id = $1", [plan])).rows;

    await db.query("delete from notification_events");
    await asUser(db, B, "select replace_planting($1, $2)", [pl.id, crop["무"]]);

    const cell = await one<{ name: string }>(
      A,
      "select cr.name from field_plan_cells c join crops cr on cr.id = c.crop_id where c.plan_id = $1",
      [plan],
    );
    expect(cell.name).toBe("무");
    const old = await one<{ status: string }>(A, "select status from plantings where id = $1", [pl.id]);
    expect(old.status).toBe("replaced");
    const events = await asUser<{ recipient_id: string; type: string }>(db, A, "select recipient_id, type from notification_events");
    expect(events).toEqual([{ recipient_id: A, type: "planting_change" }]);
    expect(await status(plan)).toBe("confirmed");
  });
});
