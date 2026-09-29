import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./db";

const OWNER = "00000000-0000-0000-0000-0000000000a1";
const MEMBER = "00000000-0000-0000-0000-0000000000b1";
const STRANGER = "00000000-0000-0000-0000-0000000000c1";
const ADMIN = "00000000-0000-0000-0000-0000000000d1";

let db: PGlite;
let farmId: string;
let otherFarmId: string;
let cropId: string;
let draftCropId: string;
let planId: string;
let planCropId: string;
let workLogId: string;

async function one<T>(userId: string | null, sql: string, params: unknown[] = []) {
  const rows = await asUser<T>(db, userId, sql, params);
  return rows[0];
}

beforeAll(async () => {
  db = await createTestDb();
  for (const u of [OWNER, MEMBER, STRANGER, ADMIN]) await createUser(db, u);
  await db.query("insert into app_admins (user_id) values ($1)", [ADMIN]);

  farmId = (await one<{ id: string }>(OWNER, "select create_farm('우리밭', 37.6, 126.7) as id")).id;
  otherFarmId = (await one<{ id: string }>(STRANGER, "select create_farm('남의밭', 35, 128) as id")).id;
  const token = (await one<{ t: string }>(OWNER, "select create_farm_invite($1) as t", [farmId])).t;
  await asUser(db, MEMBER, "select accept_farm_invite($1)", [token]);

  cropId = (
    await one<{ id: string }>(
      ADMIN,
      "insert into crops (name, status, days_to_harvest, plants_per_pyeong) values ('배추', 'confirmed', 70, 9) returning id",
    )
  ).id;
  draftCropId = (
    await one<{ id: string }>(ADMIN, "insert into crops (name) values ('고수') returning id")
  ).id;

  planId = (
    await one<{ id: string }>(
      OWNER,
      "insert into field_plans (farm_id, year, season) values ($1, 2026, 'autumn') returning id",
      [farmId],
    )
  ).id;
  planCropId = (
    await one<{ id: string }>(
      OWNER,
      "insert into plan_crops (plan_id, crop_id) values ($1, $2) returning id",
      [planId, cropId],
    )
  ).id;
  workLogId = (
    await one<{ id: string }>(
      MEMBER,
      "insert into work_logs (farm_id, work_date, work_type, created_by) values ($1, '2026-09-29', 'watering', $2) returning id",
      [farmId, MEMBER],
    )
  ).id;
  await asUser(db, MEMBER, "insert into work_log_targets (work_log_id, plan_crop_id) values ($1, $2)", [
    workLogId,
    planCropId,
  ]);
});

describe("schema", () => {
  it("every public table has RLS enabled", async () => {
    const res = await db.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and not rowsecurity",
    );
    expect(res.rows).toEqual([]);
  });

  it("farm creation creates default settings", async () => {
    const s = await one<{ cell_size_m: string; geofence_radius_m: number; rain_pop_threshold: number; watering_rain_mm: string | null }>(
      OWNER,
      "select cell_size_m, geofence_radius_m, rain_pop_threshold, watering_rain_mm from farm_settings where farm_id = $1",
      [farmId],
    );
    expect(Number(s.cell_size_m)).toBe(0.5);
    expect(s.geofence_radius_m).toBe(200);
    expect(s.rain_pop_threshold).toBe(60);
    expect(s.watering_rain_mm).toBeNull();
  });

  it("seeds default fertilizer products", async () => {
    const rows = await asUser<{ name: string; n_pct: string; p_pct: string; k_pct: string }>(
      db,
      OWNER,
      "select name, n_pct, p_pct, k_pct from fertilizer_products where farm_id is null order by name",
    );
    expect(rows.map((r) => [r.name, Number(r.n_pct), Number(r.p_pct), Number(r.k_pct)])).toEqual([
      ["복합비료", 21, 17, 17],
      ["요소", 46, 0, 0],
    ]);
  });

  it("companion pairs must be ordered", async () => {
    const [a, b] = [cropId, draftCropId].sort();
    await asUser(db, ADMIN, "insert into crop_companions (crop_a_id, crop_b_id, relation) values ($1, $2, 'good')", [a, b]);
    await expect(
      asUser(db, ADMIN, "insert into crop_companions (crop_a_id, crop_b_id, relation) values ($1, $2, 'bad')", [b, a]),
    ).rejects.toThrow(/check constraint/);
  });

  it("rain log requires mm", async () => {
    await expect(
      asUser(db, OWNER, "insert into work_logs (farm_id, work_date, work_type) values ($1, '2026-09-29', 'rain')", [farmId]),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("crop data access", () => {
  it("users see only confirmed crops, admin sees all", async () => {
    const userRows = await asUser<{ name: string }>(db, OWNER, "select name from crops order by name");
    expect(userRows.map((r) => r.name)).toEqual(["배추"]);
    const adminRows = await asUser<{ name: string }>(db, ADMIN, "select name from crops order by name");
    expect(adminRows.map((r) => r.name).sort()).toEqual(["고수", "배추"].sort());
  });

  it("users cannot write crop data", async () => {
    await expect(asUser(db, OWNER, "insert into crops (name) values ('해킹')")).rejects.toThrow(/row-level security/);
    await asUser(db, OWNER, "update crops set name = '바뀜' where id = $1", [cropId]);
    const c = await one<{ name: string }>(ADMIN, "select name from crops where id = $1", [cropId]);
    expect(c.name).toBe("배추");
    await expect(
      asUser(db, OWNER, "insert into crop_pest_controls (crop_id, pest_name, ingredient_name) values ($1, 'x', 'y')", [cropId]),
    ).rejects.toThrow(/row-level security/);
  });

  it("crop_field_sources is admin only", async () => {
    await asUser(db, ADMIN, "insert into crop_field_sources (crop_id, field_name, extracted_value) values ($1, 'days_to_harvest', '70')", [cropId]);
    expect(await asUser(db, OWNER, "select * from crop_field_sources")).toEqual([]);
  });

  it("users cannot write weather tables", async () => {
    await expect(
      asUser(db, OWNER, "insert into weather_observations (station_id, obs_date, rain_mm) values ('108', '2026-09-28', 3)"),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("farm data isolation", () => {
  const farmScoped = [
    "farm_settings",
    "field_plans",
    "plan_crops",
    "work_logs",
    "work_log_targets",
  ];

  it("both members see farm data", async () => {
    for (const user of [OWNER, MEMBER]) {
      for (const t of farmScoped) {
        const rows = await asUser(db, user, `select 1 from ${t}`);
        expect(rows.length, `${user} ${t}`).toBeGreaterThan(0);
      }
    }
  });

  it("stranger sees none of our farm data", async () => {
    const rows = await asUser(db, STRANGER, "select 1 from field_plans where farm_id = $1", [farmId]);
    expect(rows).toEqual([]);
    for (const t of ["plan_crops", "work_logs", "work_log_targets"]) {
      expect(await asUser(db, STRANGER, `select 1 from ${t}`), t).toEqual([]);
    }
    const settings = await asUser(db, STRANGER, "select 1 from farm_settings where farm_id = $1", [farmId]);
    expect(settings).toEqual([]);
  });

  it("stranger cannot write into our farm", async () => {
    await expect(
      asUser(db, STRANGER, "insert into work_logs (farm_id, work_date, work_type) values ($1, '2026-09-29', 'other')", [farmId]),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(db, STRANGER, "insert into field_plan_cells (plan_id, x, y, crop_id) values ($1, 0, 0, $2)", [planId, cropId]),
    ).rejects.toThrow(/row-level security/);
    await asUser(db, STRANGER, "update farm_settings set cell_size_m = 9 where farm_id = $1", [farmId]);
    const s = await one<{ cell_size_m: string }>(OWNER, "select cell_size_m from farm_settings where farm_id = $1", [farmId]);
    expect(Number(s.cell_size_m)).toBe(0.5);
  });

  it("farm fertilizer products and varieties are isolated", async () => {
    await asUser(db, STRANGER, "insert into fertilizer_products (farm_id, name, n_pct, p_pct, k_pct) values ($1, '남의비료', 10, 10, 10)", [otherFarmId]);
    const names = await asUser<{ name: string }>(db, OWNER, "select name from fertilizer_products");
    expect(names.map((n) => n.name)).not.toContain("남의비료");
    await expect(
      asUser(db, OWNER, "insert into fertilizer_products (farm_id, name, n_pct, p_pct, k_pct) values (null, '공용', 1, 1, 1)"),
    ).rejects.toThrow(/row-level security/);
  });

  it("push subscriptions are per user", async () => {
    await asUser(db, OWNER, "insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push/1', 'k', 'a')", [OWNER]);
    expect(await asUser(db, MEMBER, "select 1 from push_subscriptions")).toEqual([]);
    await expect(
      asUser(db, MEMBER, "insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push/2', 'k', 'a')", [OWNER]),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("crop_variety_values", () => {
  it("falls back to crop values when variety value is null", async () => {
    await asUser(db, OWNER, "insert into crop_varieties (crop_id, farm_id, name, days_to_harvest) values ($1, $2, '빠른배추', 55)", [cropId, farmId]);
    await asUser(db, OWNER, "insert into crop_varieties (crop_id, farm_id, name) values ($1, $2, '보통배추')", [cropId, farmId]);
    const rows = await asUser<{
      name: string;
      days_to_harvest: number;
      days_to_harvest_from_variety: boolean;
      plants_per_pyeong: string;
    }>(db, OWNER, "select name, days_to_harvest, days_to_harvest_from_variety, plants_per_pyeong from crop_variety_values order by name");
    expect(rows.map((r) => [r.name, r.days_to_harvest, r.days_to_harvest_from_variety, Number(r.plants_per_pyeong)])).toEqual([
      ["보통배추", 70, false, 9],
      ["빠른배추", 55, true, 9],
    ]);
    expect(await asUser(db, STRANGER, "select 1 from crop_variety_values")).toEqual([]);
  });
});
