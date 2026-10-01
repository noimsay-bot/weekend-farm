import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { REQUIRED_CROP_FIELDS } from "../../src/lib/crop-fields";
import { asUser, createTestDb, createUser } from "./db";

const FIRST = "00000000-0000-0000-0000-0000000000e1";
const SECOND = "00000000-0000-0000-0000-0000000000e2";

let db: PGlite;
let cropId: string;

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, FIRST);
  await createUser(db, SECOND);
});

describe("admin bootstrap", () => {
  it("first caller becomes admin, second does not", async () => {
    const [a] = await asUser<{ ok: boolean }>(db, FIRST, "select claim_first_admin() as ok");
    const [b] = await asUser<{ ok: boolean }>(db, SECOND, "select claim_first_admin() as ok");
    expect([a.ok, b.ok]).toEqual([true, false]);
  });
});

describe("crop confirmation", () => {
  it("TS required field list matches DB", async () => {
    const res = await db.query<{ f: string[] }>("select crop_required_fields() as f");
    expect(REQUIRED_CROP_FIELDS.map((f) => f.name)).toEqual(res.rows[0].f);
  });

  it("non-admin cannot edit crop fields", async () => {
    const [c] = await asUser<{ id: string }>(db, FIRST, "insert into crops (name) values ('상추') returning id");
    cropId = c.id;
    await expect(
      asUser(db, SECOND, "select set_crop_field($1, 'seedling_days', '30')", [cropId]),
    ).rejects.toThrow(/admin only/);
  });

  it("cannot confirm until every field is approved or manual", async () => {
    await expect(asUser(db, FIRST, "select confirm_crop($1)", [cropId])).rejects.toThrow(/incomplete: .*days_to_harvest/);
  });

  it("approve extracted value, manual input, family by name, then confirm", async () => {
    // 추출값 (수집 스크립트가 넣는 형태)
    await db.query("update crops set days_to_harvest = 30 where id = $1", [cropId]);
    await db.query(
      "insert into crop_field_sources (crop_id, field_name, extracted_value, source_text) values ($1, 'days_to_harvest', '30', '정식후 30일경부터 수확')",
      [cropId],
    );
    await asUser(db, FIRST, "select approve_crop_field($1, 'days_to_harvest')", [cropId]);

    await asUser(db, FIRST, "select set_crop_field($1, 'family_id', '국화과')", [cropId]);
    await asUser(db, FIRST, "select set_crop_field($1, 'min_temp_c', '15')", [cropId]);
    await asUser(db, FIRST, "select set_crop_field($1, 'heat_tolerance', 'low')", [cropId]);
    await asUser(db, FIRST, "select set_crop_field($1, 'pruning_method', null)", [cropId]);

    const rest = REQUIRED_CROP_FIELDS.map((f) => f.name).filter(
      (f) => !["days_to_harvest", "family_id", "min_temp_c", "heat_tolerance", "pruning_method"].includes(f),
    );
    for (const f of rest) await asUser(db, FIRST, "select set_crop_field($1, $2, null)", [cropId, f]);

    await asUser(db, FIRST, "select confirm_crop($1)", [cropId]);

    const [crop] = await asUser<{ status: string; min_temp_c: string; heat_tolerance: string; family: string; family_status: string }>(
      db,
      SECOND,
      "select c.status, c.min_temp_c, c.heat_tolerance, f.name as family, f.status as family_status from crops c join crop_families f on f.id = c.family_id where c.id = $1",
      [cropId],
    );
    expect(crop).toMatchObject({ status: "confirmed", heat_tolerance: "low", family: "국화과", family_status: "confirmed" });
    expect(Number(crop.min_temp_c)).toBe(15);
  });

  it("quick confirm approves extracted values and confirms only draft crops with a source", async () => {
    const insert = async (name: string, url: string | null) => {
      const [c] = await asUser<{ id: string }>(db, FIRST, "insert into crops (name, source_url) values ($1, $2) returning id", [name, url]);
      return c.id;
    };
    const withSource = await insert("배추", "https://nongsaro/baechu");
    const noSource = await insert("봄동", null);
    await db.query(
      "insert into crop_field_sources (crop_id, field_name, extracted_value, source_text) values ($1, 'days_to_harvest', '70', '정식 후 70일'), ($1, 'seedling_days', null, '육묘 기간은 품종에 따라')",
      [withSource],
    );

    await expect(asUser(db, SECOND, "select quick_confirm_crops($1)", [[withSource]])).rejects.toThrow(/admin only/);
    const [r] = await asUser<{ n: number }>(db, FIRST, "select quick_confirm_crops($1) as n", [[withSource, noSource, cropId]]);
    expect(r.n).toBe(1);

    const status = await db.query<{ name: string; status: string }>("select name, status from crops where id = any($1) order by name", [
      [withSource, noSource],
    ]);
    expect(status.rows).toEqual([
      { name: "배추", status: "confirmed" },
      { name: "봄동", status: "draft" },
    ]);
    const sources = await db.query<{ field_name: string; approved: boolean }>(
      "select field_name, approved from crop_field_sources where crop_id = $1 order by field_name",
      [withSource],
    );
    // 값이 있는 필드만 승인되고, 근거 문장만 있는 필드는 그대로 남는다
    expect(sources.rows).toEqual([
      { field_name: "days_to_harvest", approved: true },
      { field_name: "seedling_days", approved: false },
    ]);
  });

  it("unconfirm returns a crop to draft unless a plan uses it", async () => {
    const [c] = await asUser<{ id: string }>(db, FIRST, "insert into crops (name, status) values ('쑥갓', 'confirmed') returning id");
    await expect(asUser(db, SECOND, "select unconfirm_crop($1)", [c.id])).rejects.toThrow(/admin only/);
    await asUser(db, FIRST, "select unconfirm_crop($1)", [c.id]);
    const { rows } = await db.query<{ status: string }>("select status from crops where id = $1", [c.id]);
    expect(rows[0].status).toBe("draft");
  });

  it("rejects unknown fields", async () => {
    await expect(asUser(db, FIRST, "select set_crop_field($1, 'status', 'confirmed')", [cropId])).rejects.toThrow(
      /unknown field/,
    );
  });
});
