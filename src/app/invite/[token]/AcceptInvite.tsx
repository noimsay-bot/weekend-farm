"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, ErrorText } from "@/components/ui";

const MESSAGES: Record<string, string> = {
  invite_not_found: "초대 링크가 올바르지 않아요.",
  invite_used: "이미 사용된 초대 링크예요. 새 링크를 요청하세요.",
  invite_expired: "만료된 초대 링크예요. 새 링크를 요청하세요.",
};

export function AcceptInvite({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function accept() {
    setBusy(true);
    setError("");
    const { error } = await createClient().rpc("accept_farm_invite", { p_token: token });
    if (error) {
      setBusy(false);
      return setError(MESSAGES[error.message] ?? "합류하지 못했어요. 다시 시도하세요.");
    }
    window.location.replace("/");
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={accept} disabled={busy}>
        {busy ? "합류하는 중…" : "농장에 합류하기"}
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
