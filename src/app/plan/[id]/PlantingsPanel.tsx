"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { todayKst } from "@/lib/season";
import { ErrorText } from "@/components/ui";
import type { PickerCrop } from "./CropPicker";

export type PlantingRow = {
  id: string;
  plan_crop_id: string;
  crop_id: string;
  status: string;
  planned_plant_count: number | null;
  cellIds: string[];
};

const STATUS: Record<string, string> = { active: "재배 중", ended: "종료", replaced: "교체됨" };

// 확정 후 작기 중 변경: 식재 종료·작물 교체는 멤버 한 명이 단독으로 처리한다.
export function PlantingsPanel({
  plantings,
  cropById,
  crops,
}: {
  plantings: PlantingRow[];
  cropById: Map<string, PickerCrop>;
  crops: PickerCrop[];
  planId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [replacing, setReplacing] = useState<string | null>(null);

  async function run(fn: () => PromiseLike<{ error: unknown }>) {
    setBusy(true);
    setError("");
    const { error } = await fn();
    setBusy(false);
    if (error) return setError("처리하지 못했어요.");
    window.location.reload();
  }

  const end = (id: string) => {
    if (!window.confirm("이 식재를 정리(종료)할까요? 다른 멤버에게 알림이 가요.")) return;
    void run(() => createClient().rpc("end_planting", { p_planting_id: id, p_ended_on: todayKst() }));
  };

  const replace = (id: string, cropId: string) =>
    run(() => createClient().rpc("replace_planting", { p_planting_id: id, p_new_crop_id: cropId }));

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">식재 영역</h2>
      <p className="text-xs text-neutral-500">병·실패로 정리하거나 다른 작물로 바꿀 때는 혼자 처리해도 돼요.</p>
      <ul className="flex flex-col gap-2">
        {plantings.map((p) => (
          <li key={p.id} className="rounded-lg bg-white p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {cropById.get(p.crop_id)?.name} · {p.cellIds.length}칸
                {p.planned_plant_count !== null && ` · 약 ${p.planned_plant_count}포기`}
              </span>
              <span className="text-xs text-neutral-500">{STATUS[p.status]}</span>
            </div>
            {p.status === "active" && (
              <div className="mt-2 flex gap-2">
                <button className="h-9 flex-1 rounded border" disabled={busy} onClick={() => end(p.id)}>
                  정리(종료)
                </button>
                <button className="h-9 flex-1 rounded border" disabled={busy} onClick={() => setReplacing(p.id)}>
                  작물 교체
                </button>
              </div>
            )}
            {replacing === p.id && (
              <select
                className="mt-2 h-10 w-full rounded border px-2"
                defaultValue=""
                onChange={(e) => e.target.value && replace(p.id, e.target.value)}
              >
                <option value="">바꿀 작물 선택</option>
                {crops
                  .filter((c) => c.id !== p.crop_id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            )}
          </li>
        ))}
      </ul>
      <ErrorText>{error}</ErrorText>
    </section>
  );
}
