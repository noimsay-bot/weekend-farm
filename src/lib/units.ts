// 단위·면적 계산. 화면 표시는 평 우선, ㎡ 괄호 병기 (계획서 M9).

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

function trim(n: number, digits: number): string {
  return n.toFixed(digits).replace(/\.?0+$/, "");
}

// "약 1.5평 (5㎡)"
export function formatArea(m2: number): string {
  const pyeong = m2ToPyeong(m2);
  const p = pyeong < 10 ? trim(pyeong, 1) : trim(Math.round(pyeong), 0);
  const m = m2 < 10 ? trim(m2, 2) : trim(m2, 1);
  return `약 ${p}평 (${m}㎡)`;
}
