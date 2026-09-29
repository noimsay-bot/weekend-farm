"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, ErrorText, Field } from "@/components/ui";

export function SizeForm({ farmId }: { farmId: string }) {
  const router = useRouter();
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await createClient()
      .from("farms")
      .update({ width_m: Number(width), height_m: Number(height), onboarding_step: "planted" })
      .eq("id", farmId);
    if (error) {
      setBusy(false);
      return setError("저장하지 못했어요. 입력값을 확인하세요.");
    }
    router.replace("/onboarding/planted");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="가로 (m)"
          type="number"
          inputMode="decimal"
          min="0.5"
          max="1000"
          step="0.1"
          required
          value={width}
          onChange={(e) => setWidth(e.target.value)}
        />
        <Field
          label="세로 (m)"
          type="number"
          inputMode="decimal"
          min="0.5"
          max="1000"
          step="0.1"
          required
          value={height}
          onChange={(e) => setHeight(e.target.value)}
        />
      </div>
      <ErrorText>{error}</ErrorText>
      <Button disabled={busy}>{busy ? "저장 중…" : "다음"}</Button>
    </form>
  );
}
