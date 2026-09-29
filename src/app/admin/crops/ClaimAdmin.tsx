"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, ErrorText } from "@/components/ui";

// 관리자가 아직 한 명도 없을 때만 성공한다 (DB 함수 claim_first_admin).
export function ClaimAdmin() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function claim() {
    setBusy(true);
    setError("");
    const { data, error } = await createClient().rpc("claim_first_admin");
    setBusy(false);
    if (error) return setError("요청하지 못했어요.");
    if (!data) return setError("이미 관리자가 있어요. 기존 관리자에게 요청하세요.");
    window.location.reload();
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="secondary" onClick={claim} disabled={busy}>
        첫 관리자로 등록하기
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
