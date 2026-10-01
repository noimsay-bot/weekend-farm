import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateCropDoc, type CropDoc } from "./schema";

const DIR = join(__dirname, "..", "..", "data", "crops");
const load = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as CropDoc;

describe("data/crops", () => {
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
    it(`${file} passes validation`, () => {
      expect(validateCropDoc(load(file))).toEqual([]);
    });
  }
});

describe("validateCropDoc", () => {
  const base = load("배추.json");
  const clone = () => JSON.parse(JSON.stringify(base)) as CropDoc;

  it("requires two sources for key fields", () => {
    const doc = clone();
    doc.fields.days_to_harvest.refs = ["r2"];
    expect(validateCropDoc(doc)).toContain("fields.days_to_harvest: 출처 2곳 이상 필요");
  });

  it("rejects unknown ref keys, bad ranges and enums", () => {
    const doc = clone();
    doc.fields.plant_spacing_cm.refs = ["r1", "r99"];
    doc.fields.seedling_days.value = 500;
    doc.fields.heat_tolerance.value = "very";
    const errors = validateCropDoc(doc);
    expect(errors).toContain("fields.plant_spacing_cm: 없는 출처 키 r99");
    expect(errors).toContain("fields.seedling_days: 범위 5~120");
    expect(errors.some((e) => e.startsWith("fields.heat_tolerance:"))).toBe(true);
  });

  it("requires every required field (null when unknown)", () => {
    const doc = clone();
    delete (doc.fields as Record<string, unknown>).rest_seasons;
    expect(validateCropDoc(doc)).toContain("fields.rest_seasons: 빠짐 (모르면 value: null)");
  });
});
