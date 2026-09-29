import { describe, expect, it } from "vitest";
import {
  baseFertilizerPlan,
  cellsToM2,
  formatArea,
  formatPesticide,
  kgPer10aToGPerPyeong,
  m2ToPyeong,
  perPlantGrams,
  plantsForArea,
  productAmount,
  productPlan,
  roundApprox,
} from "./units";

describe("area", () => {
  it("converts cells to area", () => {
    expect(cellsToM2(4, 0.5)).toBe(1);
    expect(cellsToM2(10, 1)).toBe(10);
  });

  it("converts ㎡ to 평", () => {
    expect(m2ToPyeong(3.3058)).toBeCloseTo(1);
    expect(m2ToPyeong(33.058)).toBeCloseTo(10);
  });

  it("computes planned plant count from plants per 평", () => {
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

describe("fertilizer", () => {
  it("kg/10a × 3.3 = g/평", () => {
    expect(kgPer10aToGPerPyeong(30)).toBeCloseTo(99);
    expect(kgPer10aToGPerPyeong(1000)).toBeCloseTo(3300);
  });

  it("rounds base fertilizer approximately", () => {
    expect(roundApprox(7.4)).toBe(7);
    expect(roundApprox(33)).toBe(35);
    expect(roundApprox(3300)).toBe(3300);
    expect(roundApprox(327)).toBe(330);
  });

  it("product g/평 = nutrient g/평 ÷ (pct/100)", () => {
    expect(productAmount(46, 46)).toBeCloseTo(100);
    expect(productAmount(10, 0)).toBeNull();
  });

  it("nitrogen-based product amount with P/K note", () => {
    // N 21g, P 17g, K 17g 필요 → 복합비료 21-17-17 100g이면 딱 맞음
    const exact = productPlan({ n: 21, p: 17, k: 17 }, { name: "복합비료", n_pct: 21, p_pct: 17, k_pct: 17 });
    expect(exact?.grams).toBeCloseTo(100);
    expect(exact?.note).toBeNull();
    // 요소는 인산·칼리가 없으므로 부족 안내
    const urea = productPlan({ n: 46, p: 10, k: 10 }, { name: "요소", n_pct: 46, p_pct: 0, k_pct: 0 });
    expect(urea?.grams).toBeCloseTo(100);
    expect(urea?.note).toBe("요소만 주면 인산 부족, 칼리 부족");
  });

  it("base plan per 평 and total", () => {
    const plan = baseFertilizerPlan(
      { n_kg_per_10a: 10, p_kg_per_10a: null, k_kg_per_10a: 5, compost_kg_per_10a: 1000, lime_kg_per_10a: 100 },
      3.3058 * 3,
    );
    expect(plan.perPyeong.n).toBeCloseTo(33);
    expect(plan.perPyeong.p).toBeNull();
    expect(plan.total.compost).toBeCloseTo(9900);
  });

  it("per plant top dressing = g/평 ÷ plants per 평", () => {
    // 1평에 9포기, 평당 18g → 포기당 2g
    expect(perPlantGrams(18, 9, 3.3058)).toBeCloseTo(2);
    // 실제 포기 수가 줄면 포기당 양이 늘어난다
    expect(perPlantGrams(18, 6, 3.3058)).toBeCloseTo(3);
    expect(perPlantGrams(18, 0, 1)).toBeNull();
  });
});

describe("pesticide", () => {
  it("dilution to amount per 1L, ml for liquid and g for powder", () => {
    expect(formatPesticide(1000, "액제")).toBe("1,000배 → 물 1L에 1ml");
    expect(formatPesticide(2000, "수화제")).toBe("2,000배 → 물 1L에 0.5g");
    expect(formatPesticide(500, null)).toBe("500배 → 물 1L에 2ml");
  });
});
