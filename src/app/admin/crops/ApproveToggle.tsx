"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// 승인: 원문에서 뽑은 값은 모두 승인하고, 원문에 없는 필드는 비워 둔 채 확정한다 (quick_confirm_crops).
// 승인 취소: 다시 검토 중으로 돌린다 (unconfirm_crop). 계획에 쓰인 작물은 취소할 수 없다.
export function ApproveToggle({ cropId, confirmed, hasSource }: { cropId: string; confirmed: boolean; hasSource: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { error } = confirmed
      ? await supabase.rpc("unconfirm_crop", { p_crop_id: cropId })
      : await supabase.rpc("quick_confirm_crops", { p_crop_ids: [cropId] });
    setBusy(false);
    if (error) return setError(error.message.includes("crop_in_use") ? "계획에 쓰여 취소 불가" : "실패");
    router.refresh();
  }

  if (!confirmed && !hasSource) {
    return <span className="w-20 shrink-0 text-center text-xs text-amber-700">원문 없음</span>;
  }
  return (
    <span className="flex w-20 shrink-0 flex-col items-center">
      <button
        onClick={toggle}
        disabled={busy}
        className={`h-9 w-full rounded text-xs font-medium ${confirmed ? "bg-primary text-white" : "border border-neutral-300 bg-white text-neutral-700"}`}
      >
        {busy ? "…" : confirmed ? "승인됨" : "승인"}
      </button>
      {error && <span className="mt-0.5 text-[10px] text-red-600">{error}</span>}
    </span>
  );
}
