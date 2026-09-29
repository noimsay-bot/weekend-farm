"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, ErrorText } from "@/components/ui";

export function CropActions({ cropId, canConfirm }: { cropId: string; canConfirm: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setBusy(true);
    setError("");
    const { error } = await createClient().rpc("confirm_crop", { p_crop_id: cropId });
    setBusy(false);
    if (error) return setError(`확정하지 못했어요. ${error.message}`);
    router.refresh();
  }

  async function remove() {
    if (!window.confirm("이 작물을 삭제할까요? 되돌릴 수 없어요.")) return;
    setBusy(true);
    setError("");
    const { error } = await createClient().from("crops").delete().eq("id", cropId);
    setBusy(false);
    if (error) return setError("삭제하지 못했어요. 계획에 쓰인 작물은 지울 수 없어요.");
    router.replace("/admin/crops");
    router.refresh();
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <ErrorText>{error}</ErrorText>
      <Button onClick={confirm} disabled={busy || !canConfirm}>
        확정 (앱에 노출)
      </Button>
      <Button variant="secondary" onClick={remove} disabled={busy}>
        작물 삭제
      </Button>
    </div>
  );
}
