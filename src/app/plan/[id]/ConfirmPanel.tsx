"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, ErrorText } from "@/components/ui";

const MESSAGES: Record<string, string> = {
  plan_empty: "칠한 칸이 없어요.",
  plan_not_draft: "이미 확정 요청된 계획이에요.",
  plan_not_pending: "확정 대기 중인 계획이 아니에요.",
};

export function ConfirmPanel({
  planId,
  status,
  userId,
  memberIds,
  approvedIds,
  onChanged,
}: {
  planId: string;
  status: string;
  userId: string;
  memberIds: string[];
  approvedIds: string[];
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function call(fn: "request_plan_confirmation" | "approve_plan") {
    setBusy(true);
    setError("");
    const { error } = await createClient().rpc(fn, { p_plan_id: planId });
    if (error) setError(MESSAGES[error.message] ?? "처리하지 못했어요.");
    await onChanged();
    setBusy(false);
    if (!error) window.location.reload();
  }

  if (status === "confirmed") {
    return <p className="rounded-lg bg-primary/10 p-3 text-sm font-medium text-primary">확정된 계획이에요.</p>;
  }

  const solo = memberIds.length <= 1;
  const approvedByMe = approvedIds.includes(userId);

  return (
    <section className="flex flex-col gap-2 rounded-lg bg-white p-3">
      {status === "draft" ? (
        <>
          <p className="text-sm text-neutral-600">
            {solo ? "확정하면 이 계획으로 재배 일정을 만들어요." : "확정을 요청하면 다른 멤버도 확정해야 확정돼요."}
          </p>
          <Button onClick={() => call("request_plan_confirmation")} disabled={busy}>
            {solo ? "계획 확정" : "확정 요청"}
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm">
            확정 대기 중 · {approvedIds.length}/{memberIds.length}명 확정
          </p>
          <p className="text-xs text-neutral-500">대기 중에 칸을 고치면 받은 확정이 모두 초기화돼요.</p>
          {!approvedByMe && (
            <Button onClick={() => call("approve_plan")} disabled={busy}>
              나도 확정
            </Button>
          )}
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}
