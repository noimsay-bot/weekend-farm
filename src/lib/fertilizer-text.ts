// 비료 표시 문구 (계획서 M9 단위 표시 원칙). 10a·300평 기준 표기는 노출하지 않는다.
import {
  formatGrams,
  kgPer10aToGPerPyeong,
  m2ToPyeong,
  perPlantGrams,
  productPlan,
  roundApprox,
  type Product,
} from "./units";

export type FertilizerRow = {
  stage: "base" | "top_dressing";
  n_kg_per_10a: number | null;
  p_kg_per_10a: number | null;
  k_kg_per_10a: number | null;
  compost_kg_per_10a: number | null;
  lime_kg_per_10a: number | null;
};

export type ProductRow = Product & { id: string; farm_id: string | null; is_default: boolean };

// 농장 용도별 지정 제품, 없으면 기본 제품 (밑거름: 복합비료, 추비: 요소)
export function productFor(
  usage: "base" | "top_dressing",
  products: ProductRow[],
  settings: { usage: string; product_id: string }[],
): ProductRow | null {
  const chosen = settings.find((s) => s.usage === usage);
  const byId = chosen && products.find((p) => p.id === chosen.product_id);
  if (byId) return byId;
  const defaults = products.filter((p) => p.is_default && p.farm_id === null);
  return defaults.find((p) => p.name === (usage === "base" ? "복합비료" : "요소")) ?? defaults[0] ?? null;
}

const nutrients = (r: FertilizerRow) => ({
  n: r.n_kg_per_10a === null ? null : kgPer10aToGPerPyeong(Number(r.n_kg_per_10a)),
  p: r.p_kg_per_10a === null ? null : kgPer10aToGPerPyeong(Number(r.p_kg_per_10a)),
  k: r.k_kg_per_10a === null ? null : kgPer10aToGPerPyeong(Number(r.k_kg_per_10a)),
});

// 밑거름: 1평 기준 대략량(반올림) + 보조로 식재 면적 합계량
export function baseLines(row: FertilizerRow, product: ProductRow | null, areaM2: number | null): string[] {
  const lines: string[] = [];
  const pyeong = areaM2 ? m2ToPyeong(areaM2) : null;
  const both = (gPerPyeong: number) =>
    `1평에 약 ${formatGrams(roundApprox(gPerPyeong))}` + (pyeong ? ` (심을 곳 전체 약 ${formatGrams(roundApprox(gPerPyeong * pyeong))})` : "");

  if (row.compost_kg_per_10a) lines.push(`퇴비 ${both(kgPer10aToGPerPyeong(Number(row.compost_kg_per_10a)))}`);
  if (row.lime_kg_per_10a) lines.push(`석회 ${both(kgPer10aToGPerPyeong(Number(row.lime_kg_per_10a)))}`);
  const plan = product ? productPlan(nutrients(row), product) : null;
  if (plan && product) {
    lines.push(`${product.name} ${both(plan.grams)}`);
    if (plan.note) lines.push(plan.note);
  }
  if (lines.length) lines.push("밭 전체에 고루 뿌리고 흙과 섞어 주세요.");
  return lines;
}

// 웃거름·추비: 포기당 양 = 평당 추비량 ÷ 평당 포기 수
export function topDressingLines(
  row: FertilizerRow,
  product: ProductRow | null,
  plantCount: number | null,
  areaM2: number | null,
): string[] {
  if (!product) return [];
  const plan = productPlan(nutrients(row), product);
  if (!plan) return [];
  const lines: string[] = [];
  const per = plantCount && areaM2 ? perPlantGrams(plan.grams, plantCount, areaM2) : null;
  if (per !== null) {
    lines.push(`${product.name} 포기당 약 ${formatGrams(Math.max(1, Math.round(per)))}, 포기 사이를 조금 파서 묻기`);
  } else {
    lines.push(`${product.name} 1평에 약 ${formatGrams(roundApprox(plan.grams))}, 포기 사이를 조금 파서 묻기`);
  }
  if (plan.note) lines.push(plan.note);
  return lines;
}
