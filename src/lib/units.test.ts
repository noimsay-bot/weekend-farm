import { describe, expect, it } from "vitest";
import { cellsToM2, formatArea, m2ToPyeong, plantsForArea } from "./units";

describe("units", () => {
  it("converts cells to area", () => {
    expect(cellsToM2(4, 0.5)).toBe(1);
    expect(cellsToM2(10, 1)).toBe(10);
  });

  it("converts ㎡ to 평", () => {
    expect(m2ToPyeong(3.3058)).toBeCloseTo(1);
    expect(m2ToPyeong(33.058)).toBeCloseTo(10);
  });

  it("computes planned plant count from plants per 평", () => {
    // 1평 × 9포기 = 9
    expect(plantsForArea(3.3058, 9)).toBe(9);
    // 0.5㎡ × 9/평 = 1.36 → 1 (DB 테스트와 같은 값)
    expect(plantsForArea(0.5, 9)).toBe(1);
    expect(plantsForArea(0.25, 110)).toBe(8);
    expect(plantsForArea(1, null)).toBeNull();
  });

  it("formats area 평 first with ㎡", () => {
    expect(formatArea(5)).toBe("약 1.5평 (5㎡)");
    expect(formatArea(0.25)).toBe("약 0.1평 (0.25㎡)");
    expect(formatArea(50)).toBe("약 15평 (50㎡)");
  });
});
