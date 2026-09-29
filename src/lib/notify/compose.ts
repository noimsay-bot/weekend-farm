// 알림 묶기: 기본은 매일 아침 하루 요약 1건. 기상특보와 배수점검만 즉시 발송.
export type NotificationType =
  | "task"
  | "sowing_window"
  | "seedling_start"
  | "pesticide_safety"
  | "watering"
  | "drainage"
  | "weather_alert"
  | "harvest_rain"
  | "plan_approval"
  | "planting_change"
  | "heat_advice"
  | "pest_prevention";

export const NOTIFICATION_LABEL: Record<NotificationType, string> = {
  task: "오늘·내일 할 일",
  sowing_window: "파종·정식 적기 확정",
  seedling_start: "육묘 시작 권장 시기",
  pesticide_safety: "방제 안전사용기준",
  watering: "물주기",
  drainage: "배수점검 경고",
  weather_alert: "기상특보",
  harvest_rain: "수확기 강우",
  plan_approval: "공동 확정 요청",
  planting_change: "식재 종료·교체",
  heat_advice: "폭염기 대응",
  pest_prevention: "예방 방제",
};

export const IMMEDIATE_TYPES: NotificationType[] = ["weather_alert", "drainage"];

export type Item = { type: NotificationType; text: string; recipientId?: string | null };

export type Push = { title: string; body: string; url: string; tag: string };

export function composeForUser(items: Item[], userId: string, disabled: Set<NotificationType>, dateLabel: string) {
  const mine = items.filter((i) => (!i.recipientId || i.recipientId === userId) && !disabled.has(i.type));
  const immediate: Push[] = mine
    .filter((i) => IMMEDIATE_TYPES.includes(i.type))
    .map((i, n) => ({ title: NOTIFICATION_LABEL[i.type], body: i.text, url: "/", tag: `${i.type}-${n}` }));
  const lines = mine.filter((i) => !IMMEDIATE_TYPES.includes(i.type)).map((i) => `• ${i.text}`);
  const summary: Push | null = lines.length
    ? {
        title: `주말텃밭 ${dateLabel} 요약 (${lines.length})`,
        body: lines.slice(0, 8).join("\n") + (lines.length > 8 ? `\n외 ${lines.length - 8}건` : ""),
        url: "/",
        tag: "daily-summary",
      }
    : null;
  return { summary, immediate };
}
