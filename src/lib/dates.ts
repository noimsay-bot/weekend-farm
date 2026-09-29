// date 문자열("YYYY-MM-DD") 연산. 시간대 영향을 받지 않도록 UTC 자정으로만 계산한다.

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
}

// 월·일 범위 안인지 (연도 무관, 해를 넘기는 범위 지원)
export function inMonthDayRange(
  date: string,
  range: { start_month: number; start_day: number; end_month: number; end_day: number },
): boolean {
  const [, m, d] = date.split("-").map(Number);
  const v = m * 100 + d;
  const s = range.start_month * 100 + range.start_day;
  const e = range.end_month * 100 + range.end_day;
  return s <= e ? v >= s && v <= e : v >= s || v <= e;
}

export function formatKDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  const day = ["일", "월", "화", "수", "목", "금", "토"][new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${m}/${d}(${day})`;
}
