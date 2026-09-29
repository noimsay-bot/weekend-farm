// 단위·면적 계산. 화면 표시는 평 우선, ㎡ 괄호 병기 (계획서 M9).
// 원자료의 큰 단위(비료 10a/300평, 농약 20L)는 화면에 노출하지 않는다.

export const M2_PER_PYEONG = 3.3058;

export function cellsToM2(cellCount: number, cellSizeM: number): number {
  return cellCount * cellSizeM * cellSizeM;
}

export function m2ToPyeong(m2: number): number {
  return m2 / M2_PER_PYEONG;
}

// 계획 포기 수 = 면적(평) × 평당 표준 포기 수. DB plants_for_area()와 같은 식.
export function plantsForArea(m2: number, plantsPerPyeong: number | null): number | null {
  if (plantsPerPyeong === null || plantsPerPyeong === undefined) return null;
  return Math.round(m2ToPyeong(m2) * plantsPerPyeong);
}

// 소수점 아래 불필요한 0만 지운다 (정수의 0은 유지)
function trim(n: number, digits: number): string {
  const s = n.toFixed(digits);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

// "약 1.5평 (5㎡)"
export function formatArea(m2: number): string {
  const pyeong = m2ToPyeong(m2);
  const p = pyeong < 10 ? trim(pyeong, 1) : trim(Math.round(pyeong), 0);
  const m = m2 < 10 ? trim(m2, 2) : trim(m2, 1);
  return `약 ${p}평 (${m}㎡)`;
}

// ───────────── 비료 ─────────────

// 환산식: kg/10a × 3.3 = g/평
export function kgPer10aToGPerPyeong(kgPer10a: number): number {
  return kgPer10a * 3.3;
}

// 밑거름 대략량 반올림: 10g 미만 1g 단위, 100g 미만 5g 단위, 그 이상 10g 단위
export function roundApprox(g: number): number {
  if (g < 10) return Math.round(g);
  if (g < 100) return Math.round(g / 5) * 5;
  return Math.round(g / 10) * 10;
}

export function formatGrams(g: number): string {
  if (g >= 1000) return `${trim(g / 1000, 1)}kg`;
  return `${trim(g, g < 10 ? 1 : 0)}g`;
}

type Nutrients = {
  n_kg_per_10a: number | null;
  p_kg_per_10a: number | null;
  k_kg_per_10a: number | null;
};

type BaseRow = Nutrients & { compost_kg_per_10a: number | null; lime_kg_per_10a: number | null };

export type AmountSet = { compost: number | null; lime: number | null; n: number | null; p: number | null; k: number | null };

// 밑거름(전면 살포): 1평 기준 g과 식재 면적 합계 g (성분량 기준, 제품 환산은 productAmount)
export function baseFertilizerPlan(row: BaseRow, areaM2: number): { perPyeong: AmountSet; total: AmountSet } {
  const per = (v: number | null) => (v === null ? null : kgPer10aToGPerPyeong(Number(v)));
  const perPyeong: AmountSet = {
    compost: per(row.compost_kg_per_10a),
    lime: per(row.lime_kg_per_10a),
    n: per(row.n_kg_per_10a),
    p: per(row.p_kg_per_10a),
    k: per(row.k_kg_per_10a),
  };
  const pyeong = m2ToPyeong(areaM2);
  const total = Object.fromEntries(
    Object.entries(perPyeong).map(([k, v]) => [k, v === null ? null : v * pyeong]),
  ) as AmountSet;
  return { perPyeong, total };
}

// 제품 g/평 = 성분 g/평 ÷ (성분% / 100)
export function productAmount(nutrientG: number, pct: number): number | null {
  return pct > 0 ? nutrientG / (pct / 100) : null;
}

export type Product = { name: string; n_pct: number; p_pct: number; k_pct: number };

// 질소 기준 제품량과, 그 양을 줬을 때 인산·칼리 과부족 한 줄 안내
export function productPlan(nutrients: { n: number | null; p: number | null; k: number | null }, product: Product) {
  if (nutrients.n === null || nutrients.n <= 0) return null;
  const grams = productAmount(nutrients.n, Number(product.n_pct));
  if (grams === null) return null;
  const supplied = { p: (grams * Number(product.p_pct)) / 100, k: (grams * Number(product.k_pct)) / 100 };
  const notes: string[] = [];
  for (const [key, label] of [["p", "인산"], ["k", "칼리"]] as const) {
    const need = nutrients[key];
    if (need === null || need <= 0) continue;
    const ratio = supplied[key] / need;
    if (ratio < 0.8) notes.push(`${label} 부족`);
    else if (ratio > 1.2) notes.push(`${label} 많음`);
  }
  return {
    grams,
    note: notes.length ? `${product.name}만 주면 ${notes.join(", ")}` : null,
  };
}

// 웃거름·추비(포기 사이에 묻기): 포기당 양 = 평당 추비량 ÷ 평당 포기 수
// 평당 포기 수는 실제 포기 수(없으면 계획 포기 수) ÷ 식재 면적(평)
export function perPlantGrams(gPerPyeong: number, plantCount: number, areaM2: number): number | null {
  if (plantCount <= 0 || areaM2 <= 0) return null;
  const plantsPerPyeong = plantCount / m2ToPyeong(areaM2);
  return gPerPyeong / plantsPerPyeong;
}

// ───────────── 농약 ─────────────

// "1,000배 → 물 1L에 1ml". 액제는 ml, 수화제·입제는 g.
export function pesticidePerLiter(dilutionFactor: number, formulation: string | null): { amount: number; unit: "ml" | "g" } {
  const unit = formulation && /수화|입제|분제|과립|g/.test(formulation) ? "g" : "ml";
  return { amount: 1000 / dilutionFactor, unit };
}

export function formatPesticide(dilutionFactor: number, formulation: string | null): string {
  const { amount, unit } = pesticidePerLiter(dilutionFactor, formulation);
  const a = amount >= 1 ? trim(amount, 1) : trim(amount, 2);
  return `${dilutionFactor.toLocaleString("ko-KR")}배 → 물 1L에 ${a}${unit}`;
}
