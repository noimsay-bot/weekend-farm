import { describe, expect, it } from "vitest";
import { composeForUser } from "./compose";
import { drainageAlert, frostDays, preHarvestConflicts, shouldLogRain, wateringDue } from "./rules";
import type { DailyForecast } from "../weather/recommend";

const day = (date: string, pop = 0, pcpMm = 0, minC = 10): DailyForecast => ({ date, minC, maxC: 20, pop, pcpMm });

describe("rain auto log", () => {
  it("only when observed rain reaches the watering threshold", () => {
    expect(shouldLogRain(12, 10)).toBe(true);
    expect(shouldLogRain(9.9, 10)).toBe(false);
    expect(shouldLogRain(30, null)).toBe(false); // 기준 미설정이면 만들지 않음
  });
});

describe("wateringDue", () => {
  const crops = [
    { planCropId: "a", cropName: "고추", intervalDays: 4, plantedOn: "2026-06-01" },
    { planCropId: "b", cropName: "상추", intervalDays: 2, plantedOn: "2026-06-01" },
    { planCropId: "c", cropName: "마늘", intervalDays: null, plantedOn: "2026-06-01" },
  ];
  const settings = { popThreshold: 60, wateringRainMm: 10 };

  it("per crop from last watering or rain log", () => {
    const logs = [
      { plan_crop_id: "a", work_date: "2026-06-08", work_type: "rain" as const },
      { plan_crop_id: "b", work_date: "2026-06-09", work_type: "watering" as const },
    ];
    const due = wateringDue(crops, logs, [day("2026-06-10")], settings, "2026-06-10");
    expect(due).toEqual([]);
    const later = wateringDue(crops, logs, [day("2026-06-12")], settings, "2026-06-12");
    expect(later.map((d) => [d.cropName, d.daysSince, d.lastType])).toEqual([
      ["고추", 4, "rain"],
      ["상추", 3, "watering"],
    ]);
  });

  it("skips when enough rain is forecast", () => {
    const due = wateringDue(crops, [], [day("2026-06-12"), day("2026-06-13", 80, 15)], settings, "2026-06-12");
    expect(due).toEqual([]);
  });

  it("falls back to planting date and probability when mm threshold is unset", () => {
    const due = wateringDue(crops, [], [day("2026-06-12", 30)], { popThreshold: 60, wateringRainMm: null }, "2026-06-12");
    expect(due.map((d) => d.lastType)).toEqual(["planted", "planted"]);
  });
});

describe("drainage", () => {
  it("heavy rain warning or forecast amount", () => {
    expect(drainageAlert([], null, [{ alert_type: "호우", action: "발표" }], "2026-07-10")).toEqual({ reason: "호우특보" });
    expect(drainageAlert([day("2026-07-11", 90, 60)], 50, [], "2026-07-10")).toEqual({ reason: "7/11 예상 강수량 60mm" });
    expect(drainageAlert([day("2026-07-11", 90, 60)], null, [{ alert_type: "호우", action: "해제" }], "2026-07-10")).toBeNull();
  });
});

describe("pesticide pre-harvest interval", () => {
  it("warns when harvest is before safe date", () => {
    const conflicts = preHarvestConflicts(
      [{ planCropId: "a", cropName: "고추", appliedOn: "2026-07-01", ingredient: "성분A", safeDays: 7 }],
      [
        { planCropId: "a", date: "2026-07-05" },
        { planCropId: "a", date: "2026-07-09" },
      ],
    );
    expect(conflicts).toEqual([{ cropName: "고추", ingredient: "성분A", harvestDate: "2026-07-05", safeFrom: "2026-07-08" }]);
  });
});

describe("frost", () => {
  it("forecast min at or below 0", () => {
    expect(frostDays([day("2026-10-20", 0, 0, 1), day("2026-10-21", 0, 0, -1)], "2026-10-20")).toEqual(["2026-10-21"]);
  });
});

describe("composeForUser", () => {
  it("bundles into one daily summary, immediate only for warnings and drainage", () => {
    const { summary, immediate } = composeForUser(
      [
        { type: "task", text: "오늘 배추 1차 추비" },
        { type: "watering", text: "상추 물주기 (3일 지남)" },
        { type: "weather_alert", text: "폭염경보 발표" },
        { type: "plan_approval", text: "확정 요청", recipientId: "other" },
      ],
      "me",
      new Set(["watering"]),
      "10/1",
    );
    expect(summary?.body).toBe("• 오늘 배추 1차 추비");
    expect(summary?.title).toBe("주말텃밭 10/1 요약 (1)");
    expect(immediate.map((p) => p.body)).toEqual(["폭염경보 발표"]);
  });
});
