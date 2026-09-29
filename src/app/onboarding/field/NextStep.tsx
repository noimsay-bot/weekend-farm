"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorText } from "@/components/ui";
import { advanceOnboarding } from "../advance";

export function NextStep({ farmId }: { farmId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function next() {
    setBusy(true);
    try {
      await advanceOnboarding(farmId, { onboarding_step: "planted" });
      router.replace("/onboarding/planted");
      router.refresh();
    } catch {
      setBusy(false);
      setError("저장하지 못했어요. 다시 시도하세요.");
    }
  }

  return (
    <>
      <ErrorText>{error}</ErrorText>
      <Button onClick={next} disabled={busy}>
        다음
      </Button>
    </>
  );
}
