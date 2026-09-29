import { createClient } from "@/lib/supabase/server";
import { sendToUser } from "@/lib/server/push";

// 로그인한 사용자 본인에게 테스트 알림
export async function POST() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const sent = await sendToUser(supabase, userId, [
    { title: "주말텃밭 테스트 알림", body: "알림이 잘 도착했어요.", url: "/settings/notifications", tag: "test" },
  ]);
  return Response.json({ sent });
}
