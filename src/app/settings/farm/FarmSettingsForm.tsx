"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, ErrorText, Field } from "@/components/ui";

export type FarmSettings = {
  cell_size_m: number;
  geofence_radius_m: number;
  rain_pop_threshold: number;
  rain_mm_threshold: number | null;
  watering_rain_mm: number | null;
  drainage_check_mm: number | null;
  watering_alert_enabled: boolean;
};

const s = (v: number | null) => (v === null || v === undefined ? "" : String(v));
const n = (v: string) => (v.trim() === "" ? null : Number(v));

export function FarmSettingsForm({
  farmId,
  initial,
  size,
}: {
  farmId: string;
  initial: FarmSettings;
  size: { width: number | null; height: number | null };
}) {
  const [v, setV] = useState({
    width: s(size.width),
    height: s(size.height),
    cell: s(initial.cell_size_m),
    radius: s(initial.geofence_radius_m),
    pop: s(initial.rain_pop_threshold),
    rainMm: s(initial.rain_mm_threshold),
    waterMm: s(initial.watering_rain_mm),
    drainMm: s(initial.drainage_check_mm),
    watering: initial.watering_alert_enabled,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMsg("");
    const supabase = createClient();
    const [a, b] = await Promise.all([
      supabase
        .from("farm_settings")
        .update({
          cell_size_m: Number(v.cell),
          geofence_radius_m: Number(v.radius),
          rain_pop_threshold: Number(v.pop),
          rain_mm_threshold: n(v.rainMm),
          watering_rain_mm: n(v.waterMm),
          drainage_check_mm: n(v.drainMm),
          watering_alert_enabled: v.watering,
        })
        .eq("farm_id", farmId),
      supabase.from("farms").update({ width_m: Number(v.width), height_m: Number(v.height) }).eq("id", farmId),
    ]);
    setBusy(false);
    if (a.error || b.error) return setError("저장하지 못했어요. 값을 확인하세요.");
    setMsg("저장했어요.");
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4 text-sm">
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">밭</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="가로 (m)" inputMode="decimal" value={v.width} onChange={set("width")} required />
          <Field label="세로 (m)" inputMode="decimal" value={v.height} onChange={set("height")} required />
        </div>
        <Field label="칸 크기 (m)" inputMode="decimal" value={v.cell} onChange={set("cell")} required />
        <p className="text-xs text-neutral-500">칸 크기를 바꾸면 기존 계획의 칸 위치는 그대로라 면적 계산이 달라져요.</p>
        <Field label="농장 반경 (m, 도착 확인용)" inputMode="numeric" value={v.radius} onChange={set("radius")} required />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">비 판정 기준</h2>
        <Field label="강수확률 (%) 이상이면 비" inputMode="numeric" value={v.pop} onChange={set("pop")} required />
        <Field label="예상 강수량 (mm) 이상이면 비 (비우면 확률만)" inputMode="decimal" value={v.rainMm} onChange={set("rainMm")} />
        <Field label="물주기로 치는 강수량 (mm)" inputMode="decimal" value={v.waterMm} onChange={set("waterMm")} />
        <p className="text-xs text-neutral-500">비우면 비 자동 기록을 만들지 않아요. 전날 관측 강수량이 이 값 이상이면 모든 작물에 &lsquo;비&rsquo; 기록을 남겨요.</p>
        <Field label="배수로 점검 경고 강수량 (mm)" inputMode="decimal" value={v.drainMm} onChange={set("drainMm")} />
        <p className="text-xs text-neutral-500">비우면 호우특보 때만 배수점검 경고를 보내요.</p>
        <label className="flex items-center justify-between rounded-lg bg-white p-3">
          <span>물주기 알림</span>
          <input type="checkbox" className="h-5 w-5" checked={v.watering} onChange={(e) => setV({ ...v, watering: e.target.checked })} />
        </label>
      </section>

      <ErrorText>{error}</ErrorText>
      {msg && <p className="text-primary">{msg}</p>}
      <Button disabled={busy}>{busy ? "저장 중…" : "저장"}</Button>
    </form>
  );
}
