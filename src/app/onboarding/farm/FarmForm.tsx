"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, ErrorText, Field, Screen } from "@/components/ui";
import { LocationPicker, type LatLng } from "@/components/LocationPicker";

export function FarmForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [location, setLocation] = useState<LatLng | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!location) return setError("텃밭 위치를 골라 주세요.");
    setBusy(true);
    setError("");
    const { error } = await createClient().rpc("create_farm", {
      p_name: name.trim(),
      p_lat: location.lat,
      p_lng: location.lng,
    });
    if (error) {
      setBusy(false);
      return setError("농장을 만들지 못했어요. 다시 시도하세요.");
    }
    router.replace("/onboarding/field");
    router.refresh();
  }

  return (
    <Screen title="농장 만들기">
      <form id="farm-form" onSubmit={submit}>
        <Field
          label="농장 이름"
          required
          maxLength={50}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </form>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">텃밭 위치</h2>
        <p className="text-xs text-neutral-500">날씨와 지역별 파종 시기를 맞추는 데 써요.</p>
        <LocationPicker value={location} onChange={setLocation} />
      </section>
      <ErrorText>{error}</ErrorText>
      <Button form="farm-form" disabled={busy || !location}>
        {busy ? "만드는 중…" : "다음"}
      </Button>
    </Screen>
  );
}
