"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BADGE_LABEL, type Badge } from "@/lib/dashboard/badges";
import { formatKDate } from "@/lib/dates";
import { SEASON_LABEL, type PlanSeason } from "@/lib/season";
import { gridWidth } from "@/lib/grid-fit";
import { createClient } from "@/lib/supabase/client";
import { FieldMap, type FieldMarker } from "@/components/FieldMap";
import type { DashboardData, DashPlanting } from "./load";
import { BadgeSheet } from "./BadgeSheet";

const ICON: Record<string, string> = {
  top_dressing: "비",
  watering: "물",
  prevention: "방",
  pesticide_safety: "!",
  pruning: "순",
  harvest: "수",
  field_prep: "밭",
  weather: "⚠",
  other: "·",
};

function cropColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h} 55% 62%)`;
}

export function Dashboard({ data }: { data: DashboardData }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<{ planting: DashPlanting | null; badges: Badge[] } | null>(null);

  // 다른 멤버가 완료한 작업이 사라지도록 앱으로 돌아올 때 다시 불러온다
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && router.refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  // 화면을 켜 둔 채로도 작업·기록 변경을 바로 반영한다 (여러 건이 몰려도 한 번만 다시 불러옴)
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 500);
    };
    const filter = `farm_id=eq.${data.farmId}`;
    const channel = supabase
      .channel(`dashboard:${data.farmId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "work_logs", filter }, refresh)
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [router, data.farmId]);

  const cellOwner = useMemo(() => {
    const m = new Map<string, DashPlanting>();
    for (const p of data.plantings) for (const c of p.cells) m.set(`${c.x},${c.y}`, p);
    return m;
  }, [data.plantings]);

  const markers = data.plantings
    .filter((p) => p.cells.length && (data.badges[p.id]?.length ?? 0) > 0)
    .map((p) => {
      const anchor = [...p.cells].sort((a, b) => a.y - b.y || a.x - b.x)[0];
      return { planting: p, anchor, badges: data.badges[p.id] };
    });

  // 구획 그림: 구획 심기 → 식재 (이월분은 원래 식재) → 배지 색 (경고·지연 빨강, 그 외 초록)
  const field = data.field;
  const plantingOfBp = useMemo(() => {
    const m = new Map<string, DashPlanting>();
    for (const bp of field?.bedPlantings ?? []) {
      const p = data.plantings.find((x) => x.bedPlantingId === bp.id || x.id === bp.carried_from_planting_id);
      if (p) m.set(bp.id, p);
    }
    return m;
  }, [field, data.plantings]);
  const fieldMarkers = useMemo(() => {
    const out: Record<string, FieldMarker> = {};
    for (const [bpId, p] of plantingOfBp) {
      const bs = data.badges[p.id] ?? [];
      if (bs.some((b) => b.state === "weather" || b.state === "overdue")) out[bpId] = "warn";
      else if (bs.length) out[bpId] = "todo";
    }
    return out;
  }, [plantingOfBp, data.badges]);

  const openCell = (x: number, y: number) => {
    const p = cellOwner.get(`${x},${y}`);
    if (p) router.push(`/history/${p.planCropId}?cell=${x},${y}`);
  };

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">
          {data.planLabel.year} {SEASON_LABEL[data.planLabel.season as PlanSeason]} 밭
        </h1>
        <Link href={`/plan/${data.planId}`} className="text-sm text-primary">
          계획 보기
        </Link>
      </div>

      {field ? (
        <div className="rounded-2xl border border-line bg-white p-2">
          <FieldMap
            widthCm={field.widthCm}
            heightCm={field.heightCm}
            beds={field.beds}
            plantings={field.bedPlantings}
            cropNames={data.cropNames}
            markers={fieldMarkers}
            onSelectPlanting={(bpId) => {
              const p = plantingOfBp.get(bpId);
              if (!p) return;
              const badges = data.badges[p.id] ?? [];
              if (badges.length) setSheet({ planting: p, badges });
              else router.push(`/history/${p.planCropId}`);
            }}
          />
        </div>
      ) : (
      <div className="overflow-auto rounded-lg border border-neutral-300 bg-[#e9e2d0]">
        <svg viewBox={`0 0 ${data.cols} ${data.rows}`} style={{ width: gridWidth(data.cols, data.rows), aspectRatio: `${data.cols} / ${data.rows}`, display: "block", margin: "0 auto" }}>
          {data.cells.map((c) => (
            <g key={`${c.x},${c.y}`} onClick={() => openCell(c.x, c.y)} style={{ cursor: "pointer" }}>
              <rect
                x={c.x + 0.03}
                y={c.y + 0.03}
                width={0.94}
                height={0.94}
                rx={0.08}
                fill={cropColor(c.crop_id)}
                opacity={cellOwner.has(`${c.x},${c.y}`) ? 1 : 0.35}
              />
              {Math.max(data.cols, data.rows) <= 30 && (
                <text x={c.x + 0.5} y={c.y + 0.62} fontSize={0.4} textAnchor="middle" fill="#1f2a1d" pointerEvents="none">
                  {(data.cropNames[c.crop_id] ?? "").slice(0, 1)}
                </text>
              )}
              {c.companion_crop_id && <circle cx={c.x + 0.8} cy={c.y + 0.8} r={0.14} fill={cropColor(c.companion_crop_id)} stroke="#fff" strokeWidth={0.04} />}
            </g>
          ))}
          {markers.map(({ planting, anchor, badges }) => {
            const top = badges[0];
            const fill = top.state === "weather" ? "#c62828" : top.state === "overdue" ? "#e65100" : "#2e7d32";
            return (
              <g
                key={planting.id}
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSheet({ planting, badges });
                }}
              >
                <circle cx={anchor.x + 0.5} cy={anchor.y + 0.5} r={0.42} fill={fill} stroke="#fff" strokeWidth={0.06} />
                <text x={anchor.x + 0.5} y={anchor.y + 0.64} fontSize={0.4} textAnchor="middle" fill="#fff" pointerEvents="none">
                  {ICON[top.kind]}
                </text>
                {badges.length > 1 && (
                  <>
                    <circle cx={anchor.x + 0.88} cy={anchor.y + 0.12} r={0.2} fill="#222" />
                    <text x={anchor.x + 0.88} y={anchor.y + 0.2} fontSize={0.24} textAnchor="middle" fill="#fff" pointerEvents="none">
                      {badges.length}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      )}
      <p className="text-xs text-muted">
        <span className="text-primary">●</span> 할 일 · <span className="text-danger">●</span> 경고·지연 · 작물을 누르면 할 일이나 이력을 봐요
      </p>

      {data.weekly.length > 0 && (
        <section className="flex flex-col gap-2 rounded-lg bg-white p-3">
          <h2 className="font-semibold">이번 주 적기</h2>
          {data.weekly.map((w, i) => (
            <p key={i} className="text-sm">
              <span className="font-medium">{w.cropName}</span> · {w.label}
            </p>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">오늘·이번 주 할 일</h2>
        {data.todo.length === 0 && <p className="text-sm text-neutral-500">지금 할 일이 없어요.</p>}
        <ul className="flex flex-col gap-2">
          {data.todo.map((b) => (
            <li key={b.id}>
              <button
                className="flex w-full items-center gap-3 rounded-lg bg-white p-3 text-left text-sm"
                onClick={() => setSheet({ planting: data.plantings.find((p) => p.id === b.plantingId) ?? null, badges: [b] })}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs text-white ${
                    b.state === "weather" ? "bg-red-700" : b.state === "overdue" ? "bg-orange-700" : "bg-primary"
                  }`}
                >
                  {ICON[b.kind]}
                </span>
                <span className="flex-1">
                  <span className="block font-medium">{b.title}</span>
                  <span className="text-xs text-neutral-500">
                    {BADGE_LABEL[b.kind]}
                    {b.date && ` · ${formatKDate(b.date)}`}
                    {b.state === "overdue" && <span className="ml-1 font-semibold text-orange-700">지연</span>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {sheet && <BadgeSheet data={data} planting={sheet.planting} badges={sheet.badges} onClose={() => setSheet(null)} />}
    </main>
  );
}
