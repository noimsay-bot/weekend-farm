import { createAdminClient } from "@/lib/server/admin";
import { runForAllFarms } from "@/lib/server/daily-job";
import { hourKst, todayKst } from "@/lib/season";

export const maxDuration = 60;

// 기상특보·배수점검만 확인해 즉시 발송 (GitHub Actions로 3시간마다 호출)
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const report = await runForAllFarms(createAdminClient(), todayKst(), hourKst(), "alerts");
  return Response.json({ ok: true, report });
}
