"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, ErrorText } from "@/components/ui";
import { LocationPicker, type LatLng } from "@/components/LocationPicker";

export function LocationForm({ farmId, initial }: { farmId: string; initial: LatLng }) {
  const [location, setLocation] = useState<LatLng>(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const changed = location.lat !== saved.lat || location.lng !== saved.lng;

  async function save() {
    setBusy(true);
    setError("");
    const { error } = await createClient()
      .from("farms")
      .update({ lat: location.lat, lng: location.lng })
      .eq("id", farmId);
    setBusy(false);
    if (error) return setError("저장하지 못했어요. 다시 시도하세요.");
    setSaved(location);
  }

  return (
    <div className="flex flex-col gap-3">
      <LocationPicker value={location} onChange={setLocation} />
      <ErrorText>{error}</ErrorText>
      <Button onClick={save} disabled={busy || !changed}>
        {busy ? "저장 중…" : changed ? "이 위치로 저장" : "저장됨"}
      </Button>
    </div>
  );
}
