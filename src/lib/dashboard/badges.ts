// 밭 대시보드 배지 (계획서 M11)
// - 날짜 기반 작업은 해당 식재(영역)에만, 작물 단위 판정(물주기 등)은 그 작물의 모든 영역에
// - 예정일 - 표시 시작 일수(기본 5)부터 표시, 예정일이 지나 미완료면 '지연'
// - 한 영역에 여러 배지면 우선순위(기상 경보 > 지연 > 임박)로 겹치고 개수 표시
import { diffDays } from "../dates";

export type BadgeKind = "top_dressing" | "watering" | "prevention" | "pesticide_safety" | "pruning" | "harvest" | "field_prep" | "weather" | "other";

export const BADGE_LABEL: Record<BadgeKind, string> = {
  top_dressing: "추비 필요",
  watering: "물주기",
  prevention: "예방 방제",
  pesticide_safety: "방제 주의",
  pruning: "가지치기",
  harvest: "수확 적기",
  field_prep: "밭만들기",
  weather: "기상 경보",
  other: "할 일",
};

export type Badge = {
  id: string;
  kind: BadgeKind;
  state: "weather" | "overdue" | "upcoming";
  title: string;
  date: string | null;
  taskId?: string;
  detail?: Record<string, unknown>;
};

export type BadgeTask = {
  id: string;
  planting_id: string | null;
  plan_crop_id: string | null;
  task_type: string;
  title: string;
  calculated_date: string;
  adjusted_date: string | null;
  details: Record<string, unknown>;
  source_url: string | null;
};

const KIND: Record<string, BadgeKind> = {
  top_dressing: "top_dressing",
  pest_control: "prevention",
  pruning: "pruning",
  harvest: "harvest",
  field_prep: "field_prep",
  watering: "watering",
};

export function taskBadge(t: BadgeTask, today: string, leadDays: Map<string, number>): Badge | null {
  const due = t.adjusted_date ?? t.calculated_date;
  const lead = leadDays.get(t.task_type) ?? 5;
  const untilDue = diffDays(due, today);
  if (untilDue > lead) return null;
  return {
    id: `task-${t.id}`,
    kind: KIND[t.task_type] ?? "other",
    state: untilDue < 0 ? "overdue" : "upcoming",
    title: t.title,
    date: due,
    taskId: t.id,
    detail: { ...t.details, source_url: t.source_url, calculated_date: t.calculated_date },
  };
}

const RANK = { weather: 0, overdue: 1, upcoming: 2 } as const;

export function sortBadges(badges: Badge[]): Badge[] {
  return [...badges].sort((a, b) => RANK[a.state] - RANK[b.state] || (a.date ?? "").localeCompare(b.date ?? ""));
}

export type PlantingArea = { plantingId: string; planCropId: string };

// 영역별 배지 모으기
export function badgesByPlanting(input: {
  today: string;
  plantings: PlantingArea[];
  tasks: BadgeTask[];
  leadDays: Map<string, number>;
  cropBadges: { planCropId: string; badge: Badge }[]; // 물주기·방제 주의 등 작물 단위
  weather: Badge[]; // 모든 영역
}): Map<string, Badge[]> {
  const out = new Map<string, Badge[]>(input.plantings.map((p) => [p.plantingId, [...input.weather]]));
  for (const t of input.tasks) {
    const badge = taskBadge(t, input.today, input.leadDays);
    if (!badge) continue;
    if (t.planting_id && out.has(t.planting_id)) {
      out.get(t.planting_id)!.push(badge);
    } else if (t.plan_crop_id) {
      for (const p of input.plantings.filter((p) => p.planCropId === t.plan_crop_id)) out.get(p.plantingId)!.push(badge);
    }
  }
  for (const { planCropId, badge } of input.cropBadges) {
    for (const p of input.plantings.filter((p) => p.planCropId === planCropId)) out.get(p.plantingId)!.push(badge);
  }
  for (const [k, v] of out) out.set(k, sortBadges(v));
  return out;
}
