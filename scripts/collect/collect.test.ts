import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CROP_SEEDS, cropsForTitle } from "./crop-list";
import { extractGarden } from "./extract";
import { fertilizerRows, pickFertilizerStandard } from "./fertilizer";
import { preventionFromText } from "./prevention";
import { buildMissingReport } from "./report";
import { REQUIRED_CROP_FIELDS } from "../../src/lib/crop-fields";

describe("crop list", () => {
  it("has the 85 crops from appendix A without duplicates", () => {
    expect(CROP_SEEDS).toHaveLength(85);
    expect(new Set(CROP_SEEDS.map((c) => c.name)).size).toBe(85);
  });

  it("maps nongsaro titles to crops", () => {
    expect(cropsForTitle("대파 ").map((c) => c.name)).toEqual(["대파"]);
    expect(cropsForTitle("잎들깨").map((c) => c.name)).toEqual(["깻잎(들깨)"]);
    expect(cropsForTitle("호박").map((c) => c.name)).toEqual(["애호박", "단호박", "늙은호박(맷돌호박)"]);
    expect(cropsForTitle("섞어짓기")).toEqual([]);
  });
});

describe("fertilizerRows", () => {
  const baechu = extractGarden(readFileSync(join(__dirname, "fixtures", "baechu.txt"), "utf8")).fertilizers;
  const std = { code: "00001", name: "배추", preN: 20, preP: 10, preK: 12, postN: 13.5, postP: 0, postK: 9 };

  it("combines API nutrients with garden compost/lime and splits top dressing by urea ratio", () => {
    const rows = fertilizerRows("c1", std, baechu, "u");
    expect(rows[0]).toMatchObject({ stage: "base", n_kg_per_10a: 20, compost_kg_per_10a: 1000, lime_kg_per_10a: 100 });
    const tops = rows.filter((r) => r.stage === "top_dressing");
    expect(tops.map((r) => r.days_after_planting)).toEqual([15, 30, 45]);
    // 요소 7:8:12 비율
    expect(tops.map((r) => r.n_kg_per_10a)).toEqual([3.5, 4, 6]);
  });

  it("without garden steps puts all top dressing in one row with unknown timing", () => {
    const rows = fertilizerRows("c1", std, [], null);
    const tops = rows.filter((r) => r.stage === "top_dressing");
    expect(tops).toHaveLength(1);
    expect(tops[0]).toMatchObject({ days_after_planting: null, n_kg_per_10a: 13.5 });
  });

  it("does not invent nutrients when API has no standard", () => {
    const rows = fertilizerRows("c1", null, baechu, "u");
    expect(rows[0]).toMatchObject({ n_kg_per_10a: null, compost_kg_per_10a: 1000 });
  });
});

describe("preventionFromText", () => {
  it("extracts month-based and weather-based prevention with source text", () => {
    const rows = preventionFromText(
      "c1",
      "탄저병은 장마 전에 등록된 약제를 살포하여 예방한다.\n진딧물은 5월~6월에 발생초기 방제한다.",
      "u",
    );
    expect(rows).toContainEqual(expect.objectContaining({ pest_name: "탄저병", basis: "weather", weather_condition: "장마 전" }));
    expect(rows).toContainEqual(
      expect.objectContaining({ pest_name: "진딧물", basis: "calendar_by_region", start_month: 5, end_month: 6 }),
    );
  });
});

describe("missing report", () => {
  it("lists crops without source and fields by state", () => {
    const md = buildMissingReport(
      [
        {
          name: "상추",
          gardenUrl: "u",
          fertilizer: true,
          pesticides: 3,
          missingMoa: 1,
          notes: [
            { field_name: "days_to_harvest", extracted_value: "30", approved: false, manual_input: false },
            { field_name: "seedling_days", extracted_value: null, approved: false, manual_input: false },
          ],
        },
        { name: "히카마", gardenUrl: null, fertilizer: false, pesticides: 0, missingMoa: 0, notes: [] },
      ],
      REQUIRED_CROP_FIELDS,
      ["PSIS_API_KEY 없음"],
    );
    expect(md).toContain("원문이 없는 작물 (1종)");
    expect(md).toContain("히카마");
    expect(md).toMatch(/\| 상추 \| [^|]*과\(科\)[^|]* \| 육묘일수 \| 있음 \| 3건 \| 1건 \|/);
    expect(md).toContain("PSIS_API_KEY 없음");
  });
});

describe("pickFertilizerStandard", () => {
  const std = (code: string, name: string) => ({ code, name, preN: 1, preP: 1, preK: 1, postN: null, postP: null, postK: null });
  const list = [std("07003", "양상추(평야지)"), std("07004", "배추(시설재배)"), std("07005", "배추(노지재배)"), std("04003", "고추(밀식재배)"), std("01018", "콩(기경지)")];

  it("matches the name before the parenthesis and prefers open-field variants", () => {
    expect(pickFertilizerStandard(list, ["배추"])?.code).toBe("07005");
    expect(pickFertilizerStandard(list, ["양상추"])?.code).toBe("07003");
    expect(pickFertilizerStandard(list, ["고추"])?.code).toBe("04003");
    expect(pickFertilizerStandard(list, ["상추"])).toBeNull();
  });
});
