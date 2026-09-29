import { describe, expect, it } from "vitest";
import { harvestIntervalWarnings, resistanceWarnings } from "./pesticide";

describe("pesticide warnings", () => {
  const selected = [
    { ingredient: "성분A", moa: "3", safeDays: 7, cropId: "gochu" },
    { ingredient: "성분B", moa: "11", safeDays: null, cropId: "gochu" },
  ];

  it("resistance note for same MoA as previous application on same crop", () => {
    const w = resistanceWarnings(selected, [{ planCropId: "pc", cropId: "gochu", cropName: "고추", moas: ["3"] }]);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("작용기작(3)");
    expect(resistanceWarnings(selected, [{ planCropId: "pc", cropId: "gochu", cropName: "고추", moas: ["M1"] }])).toEqual([]);
  });

  it("harvest interval overlap", () => {
    const w = harvestIntervalWarnings(selected, "2026-07-01", [
      { cropId: "gochu", cropName: "고추", date: "2026-07-05" },
      { cropId: "gochu", cropName: "고추", date: "2026-07-20" },
    ]);
    expect(w).toEqual(["고추 수확 예정(2026-07-05)이 성분A의 수확 전 금지기간(수확 7일 전까지)과 겹쳐요."]);
  });
});
