import type { FertilizerExtraction } from "./extract";
import { FERT_SOURCE_URL, type FertilizerStandard } from "./sources";

// 처방 API 작물명은 '배추(노지재배)'처럼 재배형이 괄호로 붙는다. 괄호 앞 이름으로 맞추고,
// 여러 개면 정확히 같은 이름 → 노지 → 평야지 → 코드 순으로 고른다 (텃밭은 노지·평야 기준).
export function pickFertilizerStandard(standards: FertilizerStandard[], names: string[]): FertilizerStandard | null {
  const base = (s: string) => s.replace(/\(.*$/, "").trim();
  const matches = standards.filter((s) => names.includes(base(s.name)));
  const rank = (s: FertilizerStandard) =>
    names.includes(s.name.trim()) ? 0 : s.name.includes("노지") ? 1 : s.name.includes("평야지") ? 2 : 3;
  return [...matches].sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code))[0] ?? null;
}

// 비료: 성분량(N·P·K)은 처방 API, 퇴비·석회와 추비 시기는 텃밭 원문.
// 웃거름 성분은 원문 추비 회차별 요소량 비율로 나누고, 비율이 없으면 균등 분배한다.
export function fertilizerRows(
  cropId: string,
  std: FertilizerStandard | null,
  garden: FertilizerExtraction[],
  gardenUrl: string | null,
) {
  const base = garden.find((g) => g.stage === "base");
  const tops = garden.filter((g) => g.stage === "top_dressing");
  const rows: Record<string, unknown>[] = [];
  if (std || base) {
    rows.push({
      crop_id: cropId,
      stage: "base",
      sequence: 1,
      days_after_planting: null,
      n_kg_per_10a: std?.preN ?? null,
      p_kg_per_10a: std?.preP ?? null,
      k_kg_per_10a: std?.preK ?? null,
      compost_kg_per_10a: base?.compostKgPer10a ?? null,
      lime_kg_per_10a: base?.limeKgPer10a ?? null,
      note: [std && `성분량: 비료 표준사용량 처방(${std.name})`, base && `퇴비·석회: ${base.sourceText}`]
        .filter(Boolean)
        .join(" / "),
      source_url: std ? FERT_SOURCE_URL : gardenUrl,
    });
  }
  const hasPost = std && [std.postN, std.postP, std.postK].some((v) => v !== null && v > 0);
  const steps = tops.length ? tops : hasPost ? [null] : [];
  const weights = steps.every((s) => s?.ureaKgPer10a) ? steps.map((s) => s!.ureaKgPer10a!) : steps.map(() => 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const share = (v: number | null | undefined, i: number) =>
    v === null || v === undefined ? null : Math.round(((v * weights[i]) / total) * 100) / 100;

  steps.forEach((s, i) => {
    rows.push({
      crop_id: cropId,
      stage: "top_dressing",
      sequence: i + 1,
      days_after_planting: s?.daysAfterPlanting ?? null,
      n_kg_per_10a: share(std?.postN, i),
      p_kg_per_10a: share(std?.postP, i),
      k_kg_per_10a: share(std?.postK, i),
      compost_kg_per_10a: null,
      lime_kg_per_10a: null,
      note: [
        s?.sourceText,
        std && (tops.length && weights.some((w) => w !== 1) ? "성분량은 원문 회차별 요소량 비율로 분배" : "성분량 균등 분배"),
      ]
        .filter(Boolean)
        .join(" / "),
      source_url: std ? FERT_SOURCE_URL : gardenUrl,
    });
  });
  return rows;
}
