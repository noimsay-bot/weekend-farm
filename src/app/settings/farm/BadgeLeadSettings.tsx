"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const TYPES = [
  ["field_prep", "밭만들기"],
  ["top_dressing", "추비"],
  ["pest_control", "예방 방제"],
  ["pruning", "가지치기"],
  ["harvest", "수확"],
] as const;

// 대시보드 배지를 예정일 며칠 전부터 보일지 (작업 종류별, 기본 5일)
export function BadgeLeadSettings({ farmId, initial }: { farmId: string; initial: Record<string, number> }) {
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(TYPES.map(([t]) => [t, String(initial[t] ?? 5)])));
  const [saved, setSaved] = useState<string | null>(null);

  async function save(type: string, v: string) {
    const days = Number(v);
    if (!Number.isInteger(days) || days < 0 || days > 60) return;
    await createClient().from("dashboard_settings").upsert({ farm_id: farmId, task_type: type, badge_lead_days: days }, { onConflict: "farm_id,task_type" });
    setSaved(type);
  }

  return (
    <section className="flex flex-col gap-2 text-sm">
      <h2 className="font-semibold">배지 표시 시작</h2>
      <p className="text-xs text-neutral-500">예정일 며칠 전부터 밭 그림에 배지를 보일지 정해요.</p>
      <ul className="flex flex-col divide-y rounded-lg bg-white">
        {TYPES.map(([t, label]) => (
          <li key={t} className="flex items-center justify-between px-3 py-2">
            <span>{label}</span>
            <span className="flex items-center gap-1">
              <input
                className="h-9 w-16 rounded border px-2 text-right"
                inputMode="numeric"
                value={values[t]}
                onChange={(e) => setValues({ ...values, [t]: e.target.value.replace(/\D/g, "") })}
                onBlur={(e) => save(t, e.target.value)}
              />
              일 전 {saved === t && <span className="text-xs text-primary">✓</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
