"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { companionHits, companionIndex, goodCompanionsOf, type Companion } from "@/lib/companions";
import { cellsToM2, formatArea, plantsForArea } from "@/lib/units";
import { GRID_MAX_HEIGHT, gridWidth } from "@/lib/grid-fit";
import { seasonOf, todayKst, type PlanSeason } from "@/lib/season";
import { Button, ErrorText } from "@/components/ui";
import { CropPicker, type PickerCrop } from "./CropPicker";
import { ConfirmPanel } from "./ConfirmPanel";
import { PlantingsPanel, type PlantingRow } from "./PlantingsPanel";
import { WarningDetail, type RotationWarning, type Family } from "./WarningDetail";

export type CellRow = {
  id?: string;
  x: number;
  y: number;
  crop_id: string;
  companion_crop_id: string | null;
  carry_state: "carried_occupied" | "released" | null;
  rotation_flag?: boolean;
};

export type EditorData = {
  plan: { id: string; farmId: string; year: number; season: PlanSeason; status: string };
  userId: string;
  widthM: number;
  heightM: number;
  cellSizeM: number;
  hasPlanted: boolean;
  cells: CellRow[];
  crops: PickerCrop[];
  tags: { id: string; name: string }[];
  companions: Companion[];
  families: Family[];
  memberIds: string[];
  approvedIds: string[];
  warnings: RotationWarning[];
  plantings: PlantingRow[];
  heatPicks: string[];
  lastYearReference: string[];
};

type Tool = "paint" | "companion" | "erase" | "look";

const key = (x: number, y: number) => `${x},${y}`;

export function cropColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h} 55% 62%)`;
}

export function PlanEditor({ data }: { data: EditorData }) {
  const cols = Math.max(1, Math.ceil(data.widthM / data.cellSizeM));
  const rows = Math.max(1, Math.ceil(data.heightM / data.cellSizeM));
  const cropById = useMemo(() => new Map(data.crops.map((c) => [c.id, c])), [data.crops]);
  const index = useMemo(() => companionIndex(data.companions), [data.companions]);

  const [cells, setCells] = useState<Map<string, CellRow>>(() => new Map(data.cells.map((c) => [key(c.x, c.y), c])));
  // 그리는 중에는 ref가 최신 상태. 저장 기준(synced)과 비교해 바뀐 칸만 보낸다.
  const cellsRef = useRef(cells);
  const synced = useRef<Map<string, CellRow>>(new Map(cells));
  const [status, setStatus] = useState(data.plan.status);
  const [approvedIds, setApprovedIds] = useState(data.approvedIds);
  const [warnings, setWarnings] = useState<RotationWarning[]>(data.warnings);
  const [tool, setTool] = useState<Tool>("paint");
  const [selected, setSelected] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [focus, setFocus] = useState<{ x: number; y: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const editable = status !== "confirmed";
  const svgRef = useRef<SVGSVGElement>(null);
  const drawing = useRef(false);
  const touched = useRef<Set<string>>(new Set());

  const refreshServerState = useCallback(async () => {
    const supabase = createClient();
    const [{ data: plan }, { data: approvals }, { data: w }] = await Promise.all([
      supabase.from("field_plans").select("status").eq("id", data.plan.id).single(),
      supabase.from("field_plan_approvals").select("user_id").eq("plan_id", data.plan.id),
      supabase.rpc("plan_rotation_warnings", { p_plan_id: data.plan.id }),
    ]);
    if (plan) setStatus(plan.status);
    setApprovedIds((approvals ?? []).map((a) => a.user_id));
    setWarnings((w ?? []) as RotationWarning[]);
  }, [data.plan.id]);

  // 바뀐 칸만 저장한다.
  const flush = useCallback(
    async (next: Map<string, CellRow>) => {
      const prev = synced.current;
      const upserts: CellRow[] = [];
      const deletes: CellRow[] = [];
      for (const [k, c] of next) {
        const p = prev.get(k);
        if (!p || p.crop_id !== c.crop_id || p.companion_crop_id !== c.companion_crop_id) upserts.push(c);
      }
      for (const [k, p] of prev) if (!next.has(k)) deletes.push(p);
      if (!upserts.length && !deletes.length) return;

      setSaving(true);
      setError("");
      const supabase = createClient();
      const results = await Promise.all([
        upserts.length
          ? supabase.from("field_plan_cells").upsert(
              upserts.map((c) => ({ plan_id: data.plan.id, x: c.x, y: c.y, crop_id: c.crop_id, companion_crop_id: c.companion_crop_id })),
              { onConflict: "plan_id,x,y" },
            )
          : Promise.resolve({ error: null }),
        deletes.length
          ? supabase
              .from("field_plan_cells")
              .delete()
              .eq("plan_id", data.plan.id)
              .or(deletes.map((c) => `and(x.eq.${c.x},y.eq.${c.y})`).join(","))
          : Promise.resolve({ error: null }),
      ]);
      setSaving(false);
      const failed = results.find((r) => r.error);
      if (failed) {
        setError("저장하지 못했어요. 화면을 새로 고쳐 주세요.");
        return;
      }
      synced.current = new Map(next);
      await refreshServerState();
    },
    [data.plan.id, refreshServerState],
  );

  function cellAt(e: React.PointerEvent): { x: number; y: number } | null {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * cols);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * rows);
    return x >= 0 && y >= 0 && x < cols && y < rows ? { x, y } : null;
  }

  function apply(pos: { x: number; y: number }) {
    const k = key(pos.x, pos.y);
    if (touched.current.has(k)) return;
    touched.current.add(k);
    const prev = cellsRef.current;
    const cur = prev.get(k);
    if (cur?.carry_state === "carried_occupied") return;
    const next = new Map(prev);
    if (tool === "erase") {
      next.delete(k);
    } else if (tool === "paint" && selected) {
      const companion = cur?.companion_crop_id === selected ? null : (cur?.companion_crop_id ?? null);
      next.set(k, { x: pos.x, y: pos.y, crop_id: selected, companion_crop_id: companion, carry_state: null });
    } else if (tool === "companion" && selected && cur && cur.crop_id !== selected) {
      next.set(k, { ...cur, companion_crop_id: cur.companion_crop_id === selected ? null : selected });
    } else {
      return;
    }
    cellsRef.current = next;
    setCells(next);
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    const pos = cellAt(e);
    if (!pos) return;
    if (tool === "look" || !editable) {
      setFocus(pos);
      return;
    }
    if ((tool === "paint" || tool === "companion") && !selected) {
      setPickerOpen(true);
      return;
    }
    drawing.current = true;
    touched.current = new Set();
    e.currentTarget.setPointerCapture(e.pointerId);
    apply(pos);
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!drawing.current) return;
    const pos = cellAt(e);
    if (pos) apply(pos);
  }

  function onPointerUp() {
    if (!drawing.current) return;
    drawing.current = false;
    void flush(cellsRef.current);
  }

  // 궁합·연작 표시
  const cellList = useMemo(() => [...cells.values()], [cells]);
  const hits = useMemo(() => companionHits(cellList, index), [cellList, index]);
  const badCells = useMemo(() => {
    const s = new Set<string>();
    for (const h of hits) if (h.companion.relation === "bad") {
      s.add(key(h.x, h.y));
      s.add(key(h.otherX, h.otherY));
    }
    return s;
  }, [hits]);
  const goodCells = useMemo(() => {
    const s = new Set<string>();
    for (const h of hits) if (h.companion.relation === "good") {
      s.add(key(h.x, h.y));
      s.add(key(h.otherX, h.otherY));
    }
    return s;
  }, [hits]);
  const rotationCells = useMemo(() => new Set(warnings.map((w) => key(w.x, w.y))), [warnings]);

  // 작물별 칸 수·면적·포기 수 (주작물만, 이월 칸 제외)
  const summary = useMemo(() => {
    const byCrop = new Map<string, number>();
    const companionsCount = new Map<string, number>();
    for (const c of cellList) {
      if (c.carry_state === "carried_occupied") continue;
      byCrop.set(c.crop_id, (byCrop.get(c.crop_id) ?? 0) + 1);
      if (c.companion_crop_id) companionsCount.set(c.companion_crop_id, (companionsCount.get(c.companion_crop_id) ?? 0) + 1);
    }
    return { byCrop, companionsCount };
  }, [cellList]);

  // 확정된 계획(지난 작기 포함)의 칸을 누르면 그 작물의 히스토리로
  function historyHref(pos: { x: number; y: number }): string | null {
    if (status !== "confirmed") return null;
    const cell = cells.get(key(pos.x, pos.y));
    if (!cell?.id) return null;
    const planting = data.plantings.find((p) => p.cellIds.includes(cell.id!));
    return planting ? `/history/${planting.plan_crop_id}?cell=${pos.x},${pos.y}` : null;
  }

  const selectedCrop = selected ? cropById.get(selected) : null;
  const goodForSelected = selected ? goodCompanionsOf(selected, data.companions).map((id) => cropById.get(id)?.name).filter(Boolean) : [];

  // 기본은 화면 폭에 맞추고, 확대하면 가로 스크롤로 이동한다. 칸이 충분히 크면 작물 첫 글자를 보인다.
  const showLabels = Math.max(cols, rows) / zoom <= 30;
  const current = seasonOf(todayKst());
  const isCurrentSeason = current.year === data.plan.year && current.season === data.plan.season;

  return (
    <div className="flex flex-col gap-4">
      {data.lastYearReference.length > 0 && (
        <details className="rounded-lg bg-white p-3 text-sm" open={editable}>
          <summary className="cursor-pointer font-semibold">작년 이맘때 결산</summary>
          <ul className="mt-2 flex flex-col gap-1 text-neutral-700">
            {data.lastYearReference.map((l) => (
              <li key={l}>• 작년 {l}</li>
            ))}
          </ul>
        </details>
      )}
      {editable && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-4 gap-1 text-sm">
            {(
              [
                ["paint", "칠하기"],
                ["companion", "사이작물"],
                ["erase", "지우기"],
                ["look", "보기"],
              ] as [Tool, string][]
            ).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setTool(t)}
                className={`h-10 rounded ${tool === t ? "bg-primary text-white" : "border border-neutral-300 bg-white"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setPickerOpen(true)}
            className="flex h-12 items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 text-left"
          >
            {selectedCrop ? (
              <>
                <span className="h-5 w-5 rounded" style={{ background: cropColor(selectedCrop.id) }} />
                <span className="font-medium">{selectedCrop.name}</span>
                <span className="ml-auto text-xs text-neutral-500">바꾸기</span>
              </>
            ) : (
              <span className="text-neutral-500">칠할 작물 고르기</span>
            )}
          </button>
          {goodForSelected.length > 0 && (
            <p className="text-xs text-primary">같이 심으면 좋은 작물: {goodForSelected.join(", ")}</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>
          {cols}×{rows}칸 · 한 칸 {data.cellSizeM}m {saving && "· 저장 중…"}
        </span>
        <span className="flex gap-1">
          <button className="h-8 w-8 rounded border bg-white" onClick={() => setZoom((z) => Math.max(1, z / 1.5))}>
            −
          </button>
          <button className="h-8 w-8 rounded border bg-white" onClick={() => setZoom((z) => Math.min(4, z * 1.5))}>
            +
          </button>
        </span>
      </div>

      <div className="overflow-auto rounded-lg border border-neutral-300 bg-[#e9e2d0]" style={{ maxHeight: zoom === 1 ? undefined : GRID_MAX_HEIGHT }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${cols} ${rows}`}
          style={{
            width: gridWidth(cols, rows, zoom),
            aspectRatio: `${cols} / ${rows}`,
            margin: "0 auto",
            touchAction: editable && tool !== "look" ? "none" : "auto",
            display: "block",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {Array.from({ length: rows }, (_, y) =>
            Array.from({ length: cols }, (_, x) => {
              const c = cells.get(key(x, y));
              const k = key(x, y);
              const crop = c ? cropById.get(c.crop_id) : null;
              return (
                <g key={k}>
                  <rect
                    x={x + 0.03}
                    y={y + 0.03}
                    width={0.94}
                    height={0.94}
                    rx={0.08}
                    fill={c ? cropColor(c.crop_id) : "#d8cfb8"}
                    opacity={c?.carry_state === "carried_occupied" ? 0.55 : 1}
                    stroke={badCells.has(k) ? "#e07000" : goodCells.has(k) ? "#2e7d32" : focus?.x === x && focus?.y === y ? "#222" : "none"}
                    strokeWidth={0.08}
                  />
                  {crop && showLabels && (
                    <text x={x + 0.5} y={y + 0.62} fontSize={0.42} textAnchor="middle" fill="#1f2a1d" pointerEvents="none">
                      {crop.name.slice(0, 1)}
                    </text>
                  )}
                  {c?.carry_state === "carried_occupied" && (
                    <text x={x + 0.2} y={y + 0.32} fontSize={0.3} pointerEvents="none">
                      🔒
                    </text>
                  )}
                  {c?.companion_crop_id && (
                    <circle cx={x + 0.78} cy={y + 0.78} r={0.16} fill={cropColor(c.companion_crop_id)} stroke="#fff" strokeWidth={0.04} />
                  )}
                  {rotationCells.has(k) && <path d={`M ${x + 0.62} ${y + 0.05} L ${x + 0.95} ${y + 0.05} L ${x + 0.95} ${y + 0.38} Z`} fill="#c62828" />}
                </g>
              );
            }),
          )}
        </svg>
      </div>
      <p className="text-xs text-neutral-500">
        빨간 모서리: 연작 주의 · 주황 테두리: 궁합 나쁨 · 초록 테두리: 궁합 좋음 · 작은 원: 사이작물 · 🔒 점유 유지
      </p>
      <ErrorText>{error}</ErrorText>

      {focus && (
        <WarningDetail
          pos={focus}
          cell={cells.get(key(focus.x, focus.y)) ?? null}
          cropById={cropById}
          warnings={warnings.filter((w) => w.x === focus.x && w.y === focus.y)}
          hits={hits.filter((h) => (h.x === focus.x && h.y === focus.y) || (h.otherX === focus.x && h.otherY === focus.y))}
          families={data.families}
          historyHref={historyHref(focus)}
          onClose={() => setFocus(null)}
        />
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">작물별 면적·포기 수</h2>
        {summary.byCrop.size === 0 && <p className="text-sm text-neutral-500">아직 칠한 칸이 없어요.</p>}
        <ul className="flex flex-col divide-y rounded-lg bg-white text-sm">
          {[...summary.byCrop].map(([cropId, count]) => {
            const crop = cropById.get(cropId);
            const m2 = cellsToM2(count, data.cellSizeM);
            const plants = plantsForArea(m2, crop?.plants_per_pyeong ?? null);
            return (
              <li key={cropId} className="flex items-center gap-2 px-3 py-2">
                <span className="h-4 w-4 rounded" style={{ background: cropColor(cropId) }} />
                <span className="font-medium">{crop?.name}</span>
                <span className="ml-auto text-right text-xs text-neutral-600">
                  {formatArea(m2)}
                  <br />
                  {plants === null ? "재식거리 정보 없음" : plants === 0 ? "1포기 미만" : `약 ${plants}포기`}
                </span>
              </li>
            );
          })}
          {[...summary.companionsCount].map(([cropId, count]) => (
            <li key={`c-${cropId}`} className="flex items-center gap-2 px-3 py-2 text-neutral-600">
              <span className="h-3 w-3 rounded-full" style={{ background: cropColor(cropId) }} />
              <span>{cropById.get(cropId)?.name} (사이작물)</span>
              <span className="ml-auto text-xs">{count}칸 · 계산 제외</span>
            </li>
          ))}
        </ul>
      </section>

      {(warnings.length > 0 || hits.some((h) => h.companion.relation === "bad")) && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          연작 주의 {new Set(warnings.map((w) => key(w.x, w.y))).size}칸 · 궁합 나쁨 {hits.filter((h) => h.companion.relation === "bad").length}곳.
          &lsquo;보기&rsquo; 도구로 칸을 누르면 이유를 볼 수 있어요. 경고만 하고 막지는 않아요.
        </p>
      )}

      <ConfirmPanel
        planId={data.plan.id}
        status={status}
        userId={data.userId}
        memberIds={data.memberIds}
        approvedIds={approvedIds}
        onChanged={refreshServerState}
      />

      {status === "confirmed" && (
        <>
          {data.hasPlanted && isCurrentSeason && (
            <Link href={`/plan/${data.plan.id}/plantings`}>
              <Button>심은 날짜 입력하기</Button>
            </Link>
          )}
          <PlantingsPanel plantings={data.plantings} cropById={cropById} crops={data.crops} planId={data.plan.id} />
          <Link href={`/plan/${data.plan.id}/summary`}>
            <Button variant="secondary">작기 결산</Button>
          </Link>
        </>
      )}

      {pickerOpen && (
        <CropPicker
          crops={data.crops}
          tags={data.tags}
          companions={data.companions}
          heatPicks={data.heatPicks}
          selected={selected}
          onSelect={(id) => {
            setSelected(id);
            setPickerOpen(false);
            if (tool === "erase" || tool === "look") setTool("paint");
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
