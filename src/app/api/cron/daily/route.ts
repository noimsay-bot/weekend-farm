import { createAdminClient } from "@/lib/server/admin";
import { runForAllFarms } from "@/lib/server/daily-job";
import { hourKst, todayKst } from "@/lib/season";

export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

// 매일 아침(06:00 KST) 1회: 날씨·특보 갱신 → 권장일·강우 회피 재계산 → 알림 수집 → 푸시 → (핑)
export async function GET(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  const report = await runForAllFarms(createAdminClient(), todayKst(), hourKst(), "daily");
  return Response.json({ ok: true, report });
}
