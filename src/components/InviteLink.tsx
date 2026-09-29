"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, ErrorText } from "@/components/ui";

// 초대 링크 생성·공유. 링크는 72시간 후 만료되고 1회만 사용 가능하다.
export function InviteLink({ farmId }: { farmId: string }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true);
    setError("");
    const { data, error } = await createClient().rpc("create_farm_invite", { p_farm_id: farmId });
    setBusy(false);
    if (error || typeof data !== "string") return setError("초대 링크를 만들지 못했어요.");
    setUrl(`${window.location.origin}/invite/${data}`);
    setCopied(false);
  }

  async function share() {
    if (navigator.share) {
      await navigator.share({ title: "주말텃밭 초대", url }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    }
  }

  if (!url) {
    return (
      <div className="flex flex-col gap-2">
        <Button onClick={create} disabled={busy}>
          {busy ? "만드는 중…" : "초대 링크 만들기"}
        </Button>
        <ErrorText>{error}</ErrorText>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="break-all rounded-lg bg-white p-3 text-sm">{url}</p>
      <p className="text-xs text-neutral-500">72시간 동안 유효하고, 한 명만 사용할 수 있어요.</p>
      <Button onClick={share}>{copied ? "복사됨" : "공유하기"}</Button>
      <Button variant="secondary" onClick={create} disabled={busy}>
        새 링크 만들기
      </Button>
    </div>
  );
}
