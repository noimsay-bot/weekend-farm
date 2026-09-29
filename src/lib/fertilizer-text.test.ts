import { describe, expect, it } from "vitest";
import { baseLines, productFor, topDressingLines, type ProductRow } from "./fertilizer-text";

const urea: ProductRow = { id: "u", farm_id: null, is_default: true, name: "요소", n_pct: 46, p_pct: 0, k_pct: 0 };
const compound: ProductRow = { id: "c", farm_id: null, is_default: true, name: "복합비료", n_pct: 21, p_pct: 17, k_pct: 17 };
const mine: ProductRow = { id: "m", farm_id: "f", is_default: false, name: "텃밭비료", n_pct: 10, p_pct: 10, k_pct: 10 };

describe("productFor", () => {
  it("uses farm choice, else default per usage", () => {
    expect(productFor("base", [urea, compound, mine], [])?.name).toBe("복합비료");
    expect(productFor("top_dressing", [urea, compound, mine], [])?.name).toBe("요소");
    expect(productFor("base", [urea, compound, mine], [{ usage: "base", product_id: "m" }])?.name).toBe("텃밭비료");
  });
});

describe("baseLines", () => {
  it("per 평 approximate with area total, compost/lime as is", () => {
    // N 21 kg/10a → 69.3 g/평 → 복합비료 330g/평
    const lines = baseLines(
      { stage: "base", n_kg_per_10a: 21, p_kg_per_10a: 17, k_kg_per_10a: 17, compost_kg_per_10a: 1000, lime_kg_per_10a: 100 },
      compound,
      3.3058 * 2,
    );
    expect(lines).toEqual([
      "퇴비 1평에 약 3.3kg (심을 곳 전체 약 6.6kg)",
      "석회 1평에 약 330g (심을 곳 전체 약 660g)",
      "복합비료 1평에 약 330g (심을 곳 전체 약 660g)",
      "밭 전체에 고루 뿌리고 흙과 섞어 주세요.",
    ]);
    expect(lines.join(" ")).not.toMatch(/10a|300평/);
  });
});

describe("topDressingLines", () => {
  it("per plant from actual plant count", () => {
    // N 4.6 kg/10a → 15.18 g/평 → 요소 33g/평. 1평에 9포기면 포기당 약 4g
    const lines = topDressingLines(
      { stage: "top_dressing", n_kg_per_10a: 4.6, p_kg_per_10a: 0, k_kg_per_10a: 0, compost_kg_per_10a: null, lime_kg_per_10a: null },
      urea,
      9,
      3.3058,
    );
    expect(lines).toEqual(["요소 포기당 약 4g, 포기 사이를 조금 파서 묻기"]);
  });

  it("falls back to per 평 without plant count", () => {
    const lines = topDressingLines(
      { stage: "top_dressing", n_kg_per_10a: 4.6, p_kg_per_10a: 2, k_kg_per_10a: 2, compost_kg_per_10a: null, lime_kg_per_10a: null },
      urea,
      null,
      null,
    );
    expect(lines[0]).toBe("요소 1평에 약 35g, 포기 사이를 조금 파서 묻기");
    expect(lines[1]).toBe("요소만 주면 인산 부족, 칼리 부족");
  });
});
