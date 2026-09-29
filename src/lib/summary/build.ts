// 작기 결산 (계획서 M12). plan_crops별 요약. 수확량은 포함하지 않는다.
import { diffDays } from "../dates";

export type SummaryInput = {
  cropName: string;
  isCompanion: boolean;
  plantings: { sow_date: string | null; transplant_date: string | null; method: string | null; variety: string | null; status: string }[];
  logs: { work_date: string; work_type: string; memo: string | null; rain_mm: number | null; is_auto: boolean; ingredients: string[] }[];
  doneTasks: { task_type: string; title: string; calculated_date: string; adjusted_date: string | null; done_date: string | null }[];
};

export type SeasonSummary = {
  crop: string;
  isCompanion: boolean;
  plantings: { round: number; date: string | null; method: "파종" | "정식" | null; variety: string | null; status: string }[];
  topDressing: { count: number; dates: string[] };
  pestControl: { count: number; dates: string[]; ingredients: string[] };
  pestNotes: { date: string; memo: string }[];
  rain: { count: number; totalMm: number };
  plannedVsActual: { title: string; planned: string; actual: string; diffDays: number }[];
};

const PEST_MEMO = /병|벌레|충|나방|진딧물|응애|방제|약/;

export function buildSeasonSummary(input: SummaryInput): SeasonSummary {
  const plantings = [...input.plantings]
    .sort((a, b) => (a.transplant_date ?? a.sow_date ?? "9999").localeCompare(b.transplant_date ?? b.sow_date ?? "9999"))
    .map((p, i) => ({
      round: i + 1,
      date: p.transplant_date ?? p.sow_date,
      method: (p.transplant_date ? "정식" : p.sow_date ? "파종" : null) as "파종" | "정식" | null,
      variety: p.variety,
      status: p.status,
    }));
  const by = (t: string) => input.logs.filter((l) => l.work_type === t).sort((a, b) => a.work_date.localeCompare(b.work_date));
  const pest = by("pest_control");
  const rain = input.logs.filter((l) => l.work_type === "rain");
  return {
    crop: input.cropName,
    isCompanion: input.isCompanion,
    plantings,
    topDressing: { count: by("top_dressing").length, dates: by("top_dressing").map((l) => l.work_date) },
    pestControl: { count: pest.length, dates: pest.map((l) => l.work_date), ingredients: [...new Set(pest.flatMap((l) => l.ingredients))] },
    pestNotes: input.logs
      .filter((l) => !l.is_auto && l.memo && (l.work_type === "pest_control" || PEST_MEMO.test(l.memo)))
      .sort((a, b) => a.work_date.localeCompare(b.work_date))
      .map((l) => ({ date: l.work_date, memo: l.memo! })),
    rain: { count: rain.length, totalMm: Math.round(rain.reduce((s, l) => s + Number(l.rain_mm ?? 0), 0) * 10) / 10 },
    plannedVsActual: input.doneTasks
      .filter((t) => t.done_date)
      .sort((a, b) => a.calculated_date.localeCompare(b.calculated_date))
      .map((t) => ({ title: t.title, planned: t.calculated_date, actual: t.done_date!, diffDays: diffDays(t.done_date!, t.calculated_date) })),
  };
}

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

// 다음 해 계획 편집 시 참고 한 줄: "작년 고추 5/8 정식, 7/20 탄저병 방제"
export function referenceLine(s: SeasonSummary): string {
  const parts: string[] = [];
  const first = s.plantings.find((p) => p.date);
  if (first?.date) parts.push(`${md(first.date)} ${first.method}${s.plantings.length > 1 ? ` 외 ${s.plantings.length - 1}회` : ""}`);
  for (const n of s.pestNotes.slice(0, 2)) parts.push(`${md(n.date)} ${n.memo.slice(0, 20)}`);
  if (!s.pestNotes.length && s.pestControl.count) parts.push(`방제 ${s.pestControl.count}회 (${s.pestControl.dates.map(md).join(", ")})`);
  if (s.topDressing.count) parts.push(`추비 ${s.topDressing.count}회`);
  return `${s.crop}${s.isCompanion ? "(사이)" : ""} ${parts.join(", ")}`.trim();
}
