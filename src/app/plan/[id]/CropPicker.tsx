"use client";

import { useMemo, useState } from "react";
import { goodCompanionsOf, type Companion } from "@/lib/companions";

export type PickerCrop = {
  id: string;
  name: string;
  family_id: string | null;
  plants_per_pyeong: number | null;
  heat_tolerance: string | null;
  tagIds: string[];
};

function color(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h} 55% 62%)`;
}

export function CropPicker({
  crops,
  tags,
  companions,
  heatPicks = [],
  selected,
  onSelect,
  onClose,
}: {
  crops: PickerCrop[];
  tags: { id: string; name: string }[];
  companions: Companion[];
  heatPicks?: string[];
  selected: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [tag, setTag] = useState<string | null>(null);
  const [heatOnly, setHeatOnly] = useState(false);
  const heat = new Set(heatPicks);
  const [q, setQ] = useState("");
  const good = useMemo(() => new Set(selected ? goodCompanionsOf(selected, companions) : []), [selected, companions]);

  const list = crops
    .filter((c) => (!tag || c.tagIds.includes(tag)) && (!q || c.name.includes(q.trim())) && (!heatOnly || heat.has(c.id)))
    // 폭염기 추천 작물을 먼저
    .sort((a, b) => Number(heat.has(b.id)) - Number(heat.has(a.id)));

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        className="mx-auto flex max-h-[80vh] w-full max-w-md flex-col gap-3 rounded-t-2xl bg-background p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">작물 고르기</h2>
          <button className="text-sm text-neutral-500" onClick={onClose}>
            닫기
          </button>
        </div>
        <input
          className="h-11 rounded-lg border border-neutral-300 bg-white px-3 text-base"
          placeholder="작물 이름 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex gap-2 overflow-x-auto pb-1 text-sm">
          <button
            className={`shrink-0 rounded-full px-3 py-1 ${tag === null && !heatOnly ? "bg-primary text-white" : "border bg-white"}`}
            onClick={() => {
              setTag(null);
              setHeatOnly(false);
            }}
          >
            전체
          </button>
          {heat.size > 0 && (
            <button
              className={`shrink-0 rounded-full px-3 py-1 ${heatOnly ? "bg-orange-600 text-white" : "border border-orange-400 bg-white text-orange-700"}`}
              onClick={() => setHeatOnly(!heatOnly)}
            >
              폭염기 추천
            </button>
          )}
          {tags.map((t) => (
            <button
              key={t.id}
              className={`shrink-0 rounded-full px-3 py-1 ${tag === t.id ? "bg-primary text-white" : "border bg-white"}`}
              onClick={() => setTag(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>
        <ul className="flex flex-col divide-y overflow-y-auto rounded-lg bg-white">
          {list.map((c) => (
            <li key={c.id}>
              <button className="flex w-full items-center gap-3 px-3 py-3 text-left" onClick={() => onSelect(c.id)}>
                <span className="h-5 w-5 shrink-0 rounded" style={{ background: color(c.id) }} />
                <span className={c.id === selected ? "font-semibold" : ""}>{c.name}</span>
                <span className="ml-auto flex gap-1 text-xs">
                  {heat.has(c.id) && <span className="text-orange-700">고온 강함</span>}
                  {good.has(c.id) && <span className="text-primary">궁합 좋음</span>}
                </span>
              </button>
            </li>
          ))}
          {list.length === 0 && (
            <li className="px-3 py-4 text-sm text-neutral-500">
              {crops.length === 0 ? "확정된 작물이 아직 없어요. 관리자 화면에서 작물을 확정하세요." : "맞는 작물이 없어요."}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
