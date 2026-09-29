"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { IMMEDIATE_TYPES, NOTIFICATION_LABEL, type NotificationType } from "@/lib/notify/compose";
import { Button, ErrorText } from "@/components/ui";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function NotificationSettings({
  userId,
  vapidPublicKey,
  initial,
}: {
  userId: string;
  vapidPublicKey: string;
  initial: Record<string, boolean>;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [enabled, setEnabled] = useState<Record<string, boolean>>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const ok = "serviceWorker" in navigator && "PushManager" in window;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(ok);
    if (ok) navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => setSubscribed(Boolean(s)));
  }, []);

  async function subscribe() {
    setBusy(true);
    setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) });
      const json = sub.toJSON();
      const { error } = await createClient()
        .from("push_subscriptions")
        .upsert({ user_id: userId, endpoint: sub.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth }, { onConflict: "endpoint" });
      if (error) throw error;
      setSubscribed(true);
    } catch {
      setMessage("알림을 켜지 못했어요. 브라우저 알림 권한을 확인하세요.");
    }
    setBusy(false);
  }

  async function unsubscribe() {
    setBusy(true);
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await createClient().from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
    setSubscribed(false);
    setBusy(false);
  }

  async function test() {
    setMessage("");
    const res = await fetch("/api/push/test", { method: "POST" });
    const body = res.ok ? await res.json() : { sent: 0 };
    setMessage(body.sent ? "테스트 알림을 보냈어요." : "보내지 못했어요. 알림을 먼저 켜세요.");
  }

  async function toggle(type: NotificationType) {
    const next = !(enabled[type] ?? true);
    setEnabled({ ...enabled, [type]: next });
    await createClient().from("notification_settings").upsert({ user_id: userId, type, enabled: next }, { onConflict: "user_id,type" });
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      {supported === false && <p>이 브라우저는 푸시 알림을 지원하지 않아요. 홈 화면에 설치한 앱에서 열어 보세요.</p>}
      {supported && (
        <div className="flex flex-col gap-2 rounded-lg bg-white p-3">
          <p>{subscribed ? "이 기기에서 알림을 받고 있어요." : "이 기기에서 알림을 받으려면 켜세요."}</p>
          {subscribed ? (
            <>
              <Button variant="secondary" onClick={test}>
                테스트 알림 보내기
              </Button>
              <Button variant="secondary" onClick={unsubscribe} disabled={busy}>
                이 기기 알림 끄기
              </Button>
            </>
          ) : (
            <Button onClick={subscribe} disabled={busy || !vapidPublicKey}>
              알림 켜기
            </Button>
          )}
          {!vapidPublicKey && <p className="text-xs text-red-600">서버에 VAPID 키가 설정되지 않았어요.</p>}
        </div>
      )}
      <ErrorText>{message.startsWith("알림을 켜지") || message.startsWith("보내지") ? message : ""}</ErrorText>
      {message && !message.startsWith("알림을 켜지") && !message.startsWith("보내지") && <p className="text-primary">{message}</p>}

      <section className="flex flex-col gap-1">
        <h2 className="font-semibold">종류별 알림</h2>
        <p className="text-xs text-neutral-500">매일 아침 하루 요약 1건으로 묶어서 보내요. 기상특보와 배수점검은 바로 보내요.</p>
        <ul className="flex flex-col divide-y rounded-lg bg-white">
          {(Object.keys(NOTIFICATION_LABEL) as NotificationType[]).map((t) => (
            <li key={t} className="flex items-center justify-between px-3 py-3">
              <span>
                {NOTIFICATION_LABEL[t]}
                {IMMEDIATE_TYPES.includes(t) && <span className="ml-1 text-xs text-amber-700">즉시</span>}
              </span>
              <input type="checkbox" className="h-5 w-5" checked={enabled[t] ?? true} onChange={() => toggle(t)} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
