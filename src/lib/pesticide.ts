// 방제 기록 입력 시 안내 (계획서 M9)
// - 같은 작물(plan_crop)에 직전 방제와 같은 작용기작 성분을 고르면 저항성 주의
// - 수확 예정일이 '오늘 살포 + 수확 전 금지일수'보다 빠르면 경고
import { addDays } from "./dates";

export type SelectedIngredient = { ingredient: string; moa: string | null; safeDays: number | null; cropId: string };

export function resistanceWarnings(
  selected: SelectedIngredient[],
  previous: { planCropId: string; cropId: string; cropName: string; moas: string[] }[],
): string[] {
  const out: string[] = [];
  for (const prev of previous) {
    const same = selected.filter((s) => s.cropId === prev.cropId && s.moa && prev.moas.includes(s.moa));
    for (const s of same) {
      out.push(`${prev.cropName}: 직전 방제와 같은 작용기작(${s.moa})의 ${s.ingredient}예요. 저항성이 생길 수 있어 다른 작용기작으로 번갈아 쓰세요.`);
    }
  }
  return [...new Set(out)];
}

export function harvestIntervalWarnings(
  selected: SelectedIngredient[],
  applyOn: string,
  harvests: { cropId: string; cropName: string; date: string }[],
): string[] {
  const out: string[] = [];
  for (const s of selected) {
    if (s.safeDays === null) continue;
    const safeFrom = addDays(applyOn, s.safeDays);
    for (const h of harvests.filter((h) => h.cropId === s.cropId && h.date < safeFrom)) {
      out.push(`${h.cropName} 수확 예정(${h.date})이 ${s.ingredient}의 수확 전 금지기간(수확 ${s.safeDays}일 전까지)과 겹쳐요.`);
    }
  }
  return [...new Set(out)];
}
