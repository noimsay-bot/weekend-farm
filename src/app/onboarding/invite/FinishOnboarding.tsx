"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorText } from "@/components/ui";
import { advanceOnboarding } from "../advance";

export function FinishOnboarding({ farmId, hasPlanted }: { farmId: string; hasPlanted: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function finish() {
    setBusy(true);
    try {
      await advanceOnboarding(farmId, { onboarding_step: "done" });
      router.replace(hasPlanted ? "/plan?season=current" : "/plan?season=next");
      router.refresh();
    } catch {
      setBusy(false);
      setError("저장하지 못했어요. 다시 시도하세요.");
    }
  }

  return (
    <div className="mt-auto flex flex-col gap-2">
      <ErrorText>{error}</ErrorText>
      <Button variant="secondary" onClick={finish} disabled={busy}>
        완료 (나중에 초대하기)
      </Button>
    </div>
  );
}
