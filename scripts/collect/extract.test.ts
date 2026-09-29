import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractGarden, type GardenExtraction } from "./extract";

// fixtures: 농사로 텃밭가꾸기 본문 (대파 2021 신형식, 고추·상추·배추 2009 구형식)
const load = (name: string) =>
  extractGarden(readFileSync(join(__dirname, "fixtures", `${name}.txt`), "utf8"));

const value = (r: GardenExtraction, field: string) => r.fields.find((f) => f.field === field)?.value;

describe("extractGarden", () => {
  it("고추: 온도·육묘·물주기·간격·가지치기", () => {
    const r = load("gochu");
    expect(value(r, "min_temp_c")).toBe(18);
    expect(value(r, "max_temp_c")).toBe(30);
    expect(value(r, "seedling_days")).toBe(70);
    expect(value(r, "watering_interval_days")).toBe(4);
    expect(value(r, "water_need")).toBe("medium");
    expect(value(r, "plant_spacing_cm")).toBe(40);
    expect(value(r, "sow_method")).toBe("transplant");
    expect(value(r, "pruning_required")).toBe(true);
    // 수확 일수는 개화 기준이라 값 없이 근거 문장만 남긴다
    expect(value(r, "days_to_harvest")).toBeNull();
  });

  it("상추: 줄×포기 간격에서 평당 포기 수 계산, 고온 약함", () => {
    const r = load("sangchu");
    expect(value(r, "row_spacing_cm")).toBe(20);
    expect(value(r, "plant_spacing_cm")).toBe(15);
    expect(value(r, "plants_per_pyeong")).toBe(110.2);
    expect(value(r, "days_to_harvest")).toBe(30);
    expect(value(r, "heat_tolerance")).toBe("low");
    expect(value(r, "sow_method")).toBe("both");
  });

  it("대파: 재배작형 달력과 같은 문장의 간격", () => {
    const r = load("daepa");
    expect(value(r, "row_spacing_cm")).toBe(70);
    expect(value(r, "plant_spacing_cm")).toBe(10);
    expect(value(r, "days_to_harvest")).toBe(40);
    expect(value(r, "harvest_window_days")).toBe(10);
    // 단일 온도(20℃ 내외)는 범위가 아니므로 값 없이 후보만
    expect(value(r, "min_temp_c")).toBeNull();
    expect(r.calendars).toContainEqual(
      expect.objectContaining({ croppingType: "봄 재배", activity: "sow", startMonth: 3, startDay: 1, endMonth: 4, endDay: 30 }),
    );
    expect(r.calendars).toContainEqual(
      expect.objectContaining({ croppingType: "가을 재배", activity: "transplant", startMonth: 10, startDay: 1, endMonth: 11, endDay: 30 }),
    );
  });

  it("비료: 면적 기준을 kg/10a로 환산", () => {
    // 대파: kg/10a 원값
    const daepa = load("daepa").fertilizers[0];
    expect(daepa).toMatchObject({ stage: "base", compostKgPer10a: 1500, limeKgPer10a: 200, ureaKgPer10a: 25 });
    // 상추: 3.3㎡당 퇴비 5kg, 석회 670g → ÷3.3
    const sangchu = load("sangchu").fertilizers[0];
    expect(sangchu).toMatchObject({ compostKgPer10a: 1515.2, limeKgPer10a: 203 });
    // 배추: 10㎡ 기준, 웃거름 정식 후 15/30/45일
    const baechu = load("baechu").fertilizers;
    expect(baechu[0]).toMatchObject({ stage: "base", compostKgPer10a: 1000, limeKgPer10a: 100 });
    expect(baechu.filter((f) => f.stage === "top_dressing").map((f) => [f.daysAfterPlanting, f.ureaKgPer10a])).toEqual([
      [15, 7],
      [30, 8],
      [45, 12],
    ]);
  });

  it("모든 값에 근거 문장이 있다", () => {
    for (const name of ["gochu", "sangchu", "daepa", "baechu"]) {
      for (const f of load(name).fields) expect(f.sourceText.length, `${name}.${f.field}`).toBeGreaterThan(5);
    }
  });
});
