import "server-only";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Push } from "@/lib/notify/compose";

let configured = false;

function configure() {
  if (configured) return;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) throw new Error("VAPID keys are not set");
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "https://weekend-farm.vercel.app", pub, priv);
  configured = true;
}

type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

// 사용자 구독 전체에 보낸다. 만료된 구독(404/410)은 지운다.
export async function sendToUser(db: SupabaseClient, userId: string, pushes: Push[]): Promise<number> {
  if (!pushes.length) return 0;
  configure();
  const { data } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
  let sent = 0;
  for (const sub of (data ?? []) as Sub[]) {
    for (const p of pushes) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(p),
          { TTL: 12 * 3600 },
        );
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await db.from("push_subscriptions").delete().eq("id", sub.id);
          break;
        }
      }
    }
  }
  return sent;
}
