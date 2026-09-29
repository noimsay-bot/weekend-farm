// 작기와 날짜. 모든 날짜는 KST(Asia/Seoul) 기준.
// 한국 텃밭 주기: 봄(3~8월), 가을(9~11월), 월동(12~이듬해 2월).

export type PlanSeason = "spring" | "autumn" | "overwinter";

export const SEASON_LABEL: Record<PlanSeason, string> = {
  spring: "봄",
  autumn: "가을",
  overwinter: "월동",
};

// KST 오늘 날짜 "YYYY-MM-DD"
export function todayKst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
}

export type SeasonKey = { year: number; season: PlanSeason };

export function seasonOf(dateKst: string): SeasonKey {
  const [y, m] = dateKst.split("-").map(Number);
  if (m >= 3 && m <= 8) return { year: y, season: "spring" };
  if (m >= 9 && m <= 11) return { year: y, season: "autumn" };
  // 12월은 그해 월동, 1~2월은 전년도 월동
  return { year: m === 12 ? y : y - 1, season: "overwinter" };
}

const ORDER: PlanSeason[] = ["spring", "autumn", "overwinter"];

export function nextSeason({ year, season }: SeasonKey): SeasonKey {
  const i = ORDER.indexOf(season);
  return i === ORDER.length - 1 ? { year: year + 1, season: "spring" } : { year, season: ORDER[i + 1] };
}

export function seasonLabel({ year, season }: SeasonKey): string {
  return `${year} ${SEASON_LABEL[season]}`;
}
