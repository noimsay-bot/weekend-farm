"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, ErrorText } from "@/components/ui";

// 원문에서 뽑은 값은 모두 승인하고, 원문에 없는 필드는 비워 둔 채 확정한다 (quick_confirm_crops).
export function QuickConfirm({ cropIds, label, confirmText }: { cropIds: string[]; label: string; confirmText: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setError("");
    const { error } = await createClient().rpc("quick_confirm_crops", { p_crop_ids: cropIds });
    setBusy(false);
    if (error) return setError(`확정하지 못했어요. ${error.message}`);
    router.refresh();
  }

  if (cropIds.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <Button onClick={run} disabled={busy}>
        {busy ? "확정 중…" : label}
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
