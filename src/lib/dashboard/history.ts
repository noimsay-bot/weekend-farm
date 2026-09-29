import { diffDays } from "../dates";
import { WORK_TYPE_LABEL, type WorkType } from "../work-types";

// 종류별 마지막 날짜 요약: "마지막 물주기 3일 전(비) · 마지막 추비 12일 전"
export function lastDoneSummary(logs: { work_date: string; work_type: WorkType }[], today: string): string {
  const parts: string[] = [];
  const latest = (types: WorkType[]) => logs.filter((l) => types.includes(l.work_type)).sort((a, b) => b.work_date.localeCompare(a.work_date))[0];
  const water = latest(["watering", "rain"]);
  if (water) parts.push(`마지막 물주기 ${diffDays(today, water.work_date)}일 전${water.work_type === "rain" ? "(비)" : ""}`);
  for (const t of ["top_dressing", "pest_control", "pruning", "harvest"] as WorkType[]) {
    const l = latest([t]);
    if (l) parts.push(`마지막 ${WORK_TYPE_LABEL[t]} ${diffDays(today, l.work_date)}일 전`);
  }
  return parts.join(" · ");
}
