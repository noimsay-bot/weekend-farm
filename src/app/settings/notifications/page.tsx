import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Screen } from "@/components/ui";
import { NotificationSettings } from "./NotificationSettings";

export default async function NotificationsPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const { data: settings } = await supabase
    .from("notification_settings")
    .select("type, enabled")
    .eq("user_id", claims?.claims.sub ?? "");

  return (
    <Screen title="알림 설정">
      <Link href="/settings" className="text-sm text-primary">
        ← 설정
      </Link>
      <NotificationSettings
        userId={claims?.claims.sub ?? ""}
        vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""}
        initial={Object.fromEntries((settings ?? []).map((s) => [s.type, s.enabled]))}
      />
    </Screen>
  );
}
