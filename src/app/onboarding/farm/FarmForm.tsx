"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, ErrorText, Field, Screen } from "@/components/ui";

export function FarmForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");

  function fillCurrentLocation() {
    if (!("geolocation" in navigator)) return setError("이 기기에서 위치를 가져올 수 없어요.");
    setLocating(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setLocating(false);
      },
      () => {
        setLocating(false);
        setError("위치를 가져오지 못했어요. 권한을 확인하거나 직접 입력하세요.");
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await createClient().rpc("create_farm", {
      p_name: name.trim(),
      p_lat: Number(lat),
      p_lng: Number(lng),
      p_width_m: Number(width),
      p_height_m: Number(height),
    });
    if (error) {
      setBusy(false);
      return setError("농장을 만들지 못했어요. 입력값을 확인하세요.");
    }
    router.replace("/onboarding/field");
    router.refresh();
  }

  return (
    <Screen title="농장 만들기">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label="농장 이름"
          required
          maxLength={50}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="위도"
            inputMode="decimal"
            required
            value={lat}
            onChange={(e) => setLat(e.target.value)}
          />
          <Field
            label="경도"
            inputMode="decimal"
            required
            value={lng}
            onChange={(e) => setLng(e.target.value)}
          />
        </div>
        <Button type="button" variant="secondary" onClick={fillCurrentLocation} disabled={locating}>
          {locating ? "위치 찾는 중…" : "현재 위치로 설정"}
        </Button>
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
        <Button disabled={busy}>{busy ? "만드는 중…" : "다음"}</Button>
      </form>
    </Screen>
  );
}
