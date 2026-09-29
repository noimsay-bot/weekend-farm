"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorText } from "@/components/ui";
import { advanceOnboarding } from "../advance";

export function PlantedChoice({ farmId }: { farmId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function choose(hasPlanted: boolean) {
    setBusy(true);
    try {
      await advanceOnboarding(farmId, {
        onboarding_step: "invite",
        onboarding_has_planted: hasPlanted,
      });
      router.replace("/onboarding/invite");
      router.refresh();
    } catch {
      setBusy(false);
      setError("저장하지 못했어요. 다시 시도하세요.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button onClick={() => choose(true)} disabled={busy}>
        네, 심어져 있어요
      </Button>
      <Button variant="secondary" onClick={() => choose(false)} disabled={busy}>
        아니요, 비어 있어요
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
