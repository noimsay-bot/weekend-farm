"use client";

// 구획 기반 계획 편집기. '구획' 탭에서 두둑·네모 밭을 만들고(끌기·숫자), '심기' 탭에서 구획에 작물을 몇 줄로 심는다.
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  autoPlantCount,
  autoRowCount,
  bedLength,
  bedWidth,
  countsPlants,
  isVertical,
  plantCountOf,
  segmentCells,
  segmentRect,
  SOW_PATTERN_LABEL,
  type Bed,
  type BedPlanting,
  type SowPattern,
} from "@/lib/field/beds";
import { toneMap } from "@/lib/field/colors";
import { seasonOf, todayKst } from "@/lib/season";
import { FieldMap } from "@/components/FieldMap";
import { Button, ErrorText } from "@/components/ui";
import { CropPicker } from "./CropPicker";
import { ConfirmPanel } from "./ConfirmPanel";
import { PlantingsPanel } from "./PlantingsPanel";
import type { EditorData } from "./PlanEditor";
import type { RotationWarning } from "./WarningDetail";

export type BedEditorData = EditorData & {
  beds: Bed[];
  bedPlantings: BedPlanting[];
  spacing: Record<string, number | null>;
  sowing: Record<string, Sowing>;
};

type Sowing = { sowMethod: "direct" | "transplant" | "both" | null; pattern: Exclude<SowPattern, "plant"> | null; rowSpacing: number | null };

// 자료에 줄간격이 없을 때 줄뿌림 줄 수 계산에 쓰는 값
const FALLBACK_ROW_SPACING = 20;

// 작물에 고를 수 있는 심기 방식. 모종만 쓰는 작물은 모종 심기뿐, 직파 작물은 파종 방식 셋.
function patternsFor(s: Sowing | undefined): SowPattern[] {
  if (!s || s.sowMethod === "transplant" || s.sowMethod === null) return ["plant"];
  return s.sowMethod === "both" ? ["plant", "row", "hill", "broadcast"] : ["row", "hill", "broadcast"];
}

function rowsFor(bed: Bed, method: SowPattern, s: Sowing | undefined, current: number) {
  if (bed.kind === "plot" || method === "broadcast") return 1;
  if (method === "row") return autoRowCount(bed, s?.rowSpacing ?? FALLBACK_ROW_SPACING) ?? 1;
  return current;
}

type Mode = "layout" | "plant";

export function BedPlanEditor({ data }: { data: BedEditorData }) {
  const widthCm = Math.round(data.widthM * 100);
  const heightCm = Math.round(data.heightM * 100);
  const cellCm = data.cellSizeM * 100;
  const cropById = useMemo(() => new Map(data.crops.map((c) => [c.id, c])), [data.crops]);
  const cropNames = useMemo(() => Object.fromEntries(data.crops.map((c) => [c.id, c.name])), [data.crops]);
  const spacingOf = useCallback((id: string) => data.spacing[id] ?? null, [data.spacing]);

  const [beds, setBeds] = useState<Bed[]>(data.beds);
  const [bps, setBps] = useState<BedPlanting[]>(data.bedPlantings);
  const [status, setStatus] = useState(data.plan.status);
  const [approvedIds, setApprovedIds] = useState(data.approvedIds);
  const [warnings, setWarnings] = useState<RotationWarning[]>(data.warnings);
  const [mode, setMode] = useState<Mode>(data.beds.length ? "plant" : "layout");
  const [bedId, setBedId] = useState<string | null>(null);
  const [bpId, setBpId] = useState<string | null>(null);
  const [picker, setPicker] = useState<"new" | "change" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const editable = status !== "confirmed";
  const bed = beds.find((b) => b.id === bedId) ?? null;
  const bp = bps.find((p) => p.id === bpId) ?? null;
  const onBed = bed ? bps.filter((p) => p.bed_id === bed.id) : [];

  const refresh = useCallback(async () => {
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

  async function run<T>(fn: () => PromiseLike<{ data: T; error: unknown }>, after?: (d: T) => void, sync = false) {
    setBusy(true);
    setError("");
    const { data: d, error: e } = await fn();
    if (e) {
      setBusy(false);
      const msg = (e as { message?: string }).message ?? "";
      setError(msg.includes("foreign key") ? "확정된 작기에 쓰인 구획은 지울 수 없어요." : "저장하지 못했어요. 다시 시도해 주세요.");
      return false;
    }
    after?.(d);
    if (sync) {
      const { error: se } = await createClient().rpc("sync_plan_bed_cells", { p_plan_id: data.plan.id });
      if (se) setError("위치 정보를 갱신하지 못했어요.");
      await refresh();
    }
    setBusy(false);
    return true;
  }

  // ── 구획 ──
  function freeSpot(w: number, h: number): { x: number; y: number } {
    const overlaps = (x: number, y: number) =>
      beds.some((b) => x < b.x_cm + b.w_cm + 20 && x + w + 20 > b.x_cm && y < b.y_cm + b.h_cm + 20 && y + h + 20 > b.y_cm);
    for (let y = 0; y + h <= heightCm; y += 10) for (let x = 0; x + w <= widthCm; x += 10) if (!overlaps(x, y)) return { x, y };
    return { x: 0, y: 0 };
  }

  async function addBed(kind: Bed["kind"], rect?: Partial<Bed>) {
    const w = Math.min(rect?.w_cm ?? (kind === "bed" ? 80 : 120), widthCm);
    const h = Math.min(rect?.h_cm ?? (kind === "bed" ? 300 : 120), heightCm);
    const spot = rect?.x_cm !== undefined && rect?.y_cm !== undefined ? { x: rect.x_cm, y: rect.y_cm } : freeSpot(w, h);
    await run(
      () =>
        createClient()
          .from("field_beds")
          .insert({ farm_id: data.plan.farmId, kind, x_cm: spot.x, y_cm: spot.y, w_cm: w, h_cm: h })
          .select("id, kind, x_cm, y_cm, w_cm, h_cm, label")
          .single(),
      (row) => {
        setBeds((bs) => [...bs, row as Bed]);
        setBedId((row as Bed).id);
      },
    );
  }

  async function saveBed(next: Bed) {
    const clamped = {
      ...next,
      w_cm: Math.max(10, Math.min(next.w_cm, widthCm)),
      h_cm: Math.max(10, Math.min(next.h_cm, heightCm)),
    };
    clamped.x_cm = Math.max(0, Math.min(clamped.x_cm, widthCm - clamped.w_cm));
    clamped.y_cm = Math.max(0, Math.min(clamped.y_cm, heightCm - clamped.h_cm));
    setBeds((bs) => bs.map((b) => (b.id === clamped.id ? clamped : b)));
    await run(
      () =>
        createClient()
          .from("field_beds")
          .update({ kind: clamped.kind, x_cm: clamped.x_cm, y_cm: clamped.y_cm, w_cm: clamped.w_cm, h_cm: clamped.h_cm })
          .eq("id", clamped.id),
      undefined,
      editable && bps.some((p) => p.bed_id === clamped.id),
    );
  }

  async function duplicate(dir: "right" | "down", gap: number) {
    if (!bed) return;
    const x = dir === "right" ? bed.x_cm + bed.w_cm + gap : bed.x_cm;
    const y = dir === "down" ? bed.y_cm + bed.h_cm + gap : bed.y_cm;
    if (x + bed.w_cm > widthCm || y + bed.h_cm > heightCm) return setError("밭 밖으로 나가요. 간격이나 크기를 줄여 주세요.");
    await addBed(bed.kind, { x_cm: x, y_cm: y, w_cm: bed.w_cm, h_cm: bed.h_cm });
  }

  async function removeBed() {
    if (!bed || !window.confirm("이 구획을 지울까요? 이 작기에 심은 작물도 함께 지워져요.")) return;
    const supabase = createClient();
    if (editable && onBed.length) {
      const ok = await run(() => supabase.from("plan_bed_plantings").delete().eq("bed_id", bed.id).eq("plan_id", data.plan.id));
      if (!ok) return;
      setBps((ps) => ps.filter((p) => p.bed_id !== bed.id));
    }
    await run(
      () => supabase.from("field_beds").delete().eq("id", bed.id),
      () => {
        setBeds((bs) => bs.filter((b) => b.id !== bed.id));
        setBedId(null);
      },
      editable,
    );
  }

  // ── 심기 ──
  async function plant(cropId: string) {
    if (!bed) return;
    const used = onBed.reduce((m, p) => Math.max(m, p.start_cm + (p.length_cm ?? bedLength(bed))), 0);
    const start = used >= bedLength(bed) ? 0 : used;
    const s = data.sowing[cropId];
    const method: SowPattern = patternsFor(s)[0] === "plant" ? "plant" : (s?.pattern ?? "row");
    const rows = rowsFor(bed, method, s, bed.kind === "plot" ? 1 : bedWithRows(bed));
    await run(
      () =>
        createClient()
          .from("plan_bed_plantings")
          .insert({ plan_id: data.plan.id, bed_id: bed.id, crop_id: cropId, rows, method, start_cm: start, length_cm: start ? bedLength(bed) - start : null })
          .select("id, bed_id, crop_id, rows, layout, method, start_cm, length_cm, plant_count, carried_from_planting_id")
          .single(),
      (row) => {
        setBps((ps) => [...ps, row as BedPlanting]);
        setBpId((row as BedPlanting).id);
      },
      true,
    );
  }

  async function savePlanting(next: BedPlanting) {
    setBps((ps) => ps.map((p) => (p.id === next.id ? next : p)));
    await run(
      () =>
        createClient()
          .from("plan_bed_plantings")
          .update({ crop_id: next.crop_id, rows: next.rows, layout: next.layout, method: next.method, start_cm: next.start_cm, length_cm: next.length_cm, plant_count: next.plant_count })
          .eq("id", next.id),
      undefined,
      true,
    );
  }

  async function removePlanting() {
    if (!bp) return;
    await run(
      () => createClient().from("plan_bed_plantings").delete().eq("id", bp.id),
      () => {
        setBps((ps) => ps.filter((p) => p.id !== bp.id));
        setBpId(null);
      },
      true,
    );
  }

  // 연작 경고 칸 → 구획 심기
  const warned = useMemo(() => {
    const keys = new Set(warnings.map((w) => `${w.x},${w.y}`));
    const out = new Set<string>();
    for (const p of bps) {
      const b = beds.find((x) => x.id === p.bed_id);
      if (b && segmentCells(segmentRect(b, p), cellCm).some((c) => keys.has(`${c.x},${c.y}`))) out.add(p.id);
    }
    return out;
  }, [warnings, bps, beds, cellCm]);

  // 작물별 합계: 포기를 세는 심기는 포기 수, 줄뿌림·흩어뿌림은 방식 이름으로 보여준다.
  const totals = useMemo(() => {
    const m = new Map<string, { n: number; sown: Set<string> }>();
    for (const p of bps) {
      const b = beds.find((x) => x.id === p.bed_id);
      if (!b) continue;
      const t = m.get(p.crop_id) ?? { n: 0, sown: new Set<string>() };
      if (countsPlants(p.method)) t.n += plantCountOf(b, p, spacingOf(p.crop_id));
      else t.sown.add(SOW_PATTERN_LABEL[p.method]);
      m.set(p.crop_id, t);
    }
    return [...m].map(([id, t]) => [id, [t.n ? `${t.n}포기` : "", ...t.sown].filter(Boolean).join(" · ")] as const);
  }, [bps, beds, spacingOf]);

  const tones = toneMap(bps.map((p) => p.crop_id));
  const toneOf = (id: string) => tones.get(id)?.stroke ?? "#a1a1aa";

  const current = seasonOf(todayKst());
  const isCurrentSeason = current.year === data.plan.year && current.season === data.plan.season;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 rounded-xl bg-[#f0f0ee] p-1 text-sm">
        {(
          [
            ["plant", "심기"],
            ["layout", "구획 만들기"],
          ] as [Mode, string][]
        ).map(([m, label]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`h-9 rounded-lg font-medium ${mode === m ? "bg-white shadow-sm" : "text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "layout" && (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => addBed("bed")} disabled={busy} className="h-11 rounded-xl border border-line bg-white text-sm font-medium">
            + 두둑
          </button>
          <button onClick={() => addBed("plot")} disabled={busy} className="h-11 rounded-xl border border-line bg-white text-sm font-medium">
            + 네모 밭
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-line bg-white p-2">
        <FieldMap
          widthCm={widthCm}
          heightCm={heightCm}
          beds={beds}
          plantings={bps}
          cropNames={cropNames}
          spacingOf={spacingOf}
          warned={warned}
          selectedBedId={bedId}
          mode={mode}
          onSelectBed={(id) => {
            setBedId(id);
            if (!id) setBpId(null);
          }}
          onSelectPlanting={setBpId}
          onBedChange={saveBed}
        />
        <p className="px-1 pt-2 text-xs text-muted">
          {data.widthM}×{data.heightM}m · 눈금 1m
          {mode === "layout" ? " · 구획을 끌어 옮기고 초록 손잡이로 크기를 바꿔요" : " · 구획을 눌러 작물을 심어요"}
          {busy && " · 저장 중…"}
        </p>
      </div>
      {beds.length === 0 && <p className="text-sm text-muted">먼저 구획 만들기에서 두둑이나 네모 밭을 추가하세요.</p>}
      <ErrorText>{error}</ErrorText>

      {mode === "layout" && bed && <BedPanel bed={bed} onSave={saveBed} onDuplicate={duplicate} onRemove={removeBed} busy={busy} />}

      {mode === "plant" && bed && (
        <section className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">
              {bed.kind === "plot" ? "네모 밭" : isVertical(bed) ? "세로 두둑" : "가로 두둑"}
              <span className="ml-2 text-xs font-normal text-muted">
                {bed.w_cm}×{bed.h_cm}cm
              </span>
            </h2>
            {editable && (
              <button className="text-sm font-medium text-primary" onClick={() => setPicker("new")}>
                + 작물 심기
              </button>
            )}
          </div>
          {onBed.length === 0 && <p className="text-sm text-muted">아직 심은 작물이 없어요.</p>}
          <div className="flex flex-wrap gap-2">
            {onBed.map((p) => (
              <button
                key={p.id}
                onClick={() => setBpId(p.id)}
                className={`rounded-full border px-3 py-1 text-sm ${p.id === bpId ? "border-primary bg-primary-soft text-primary" : "border-line"}`}
              >
                {cropNames[p.crop_id]}
              </button>
            ))}
          </div>
          {bp && bp.bed_id === bed.id && (
            <PlantingPanel
              bed={bed}
              planting={bp}
              cropName={cropNames[bp.crop_id] ?? ""}
              tone={toneOf(bp.crop_id)}
              spacing={spacingOf(bp.crop_id)}
              sowing={data.sowing[bp.crop_id]}
              editable={editable && !bp.carried_from_planting_id}
              warned={warned.has(bp.id)}
              onSave={savePlanting}
              onChangeCrop={() => setPicker("change")}
              onRemove={removePlanting}
            />
          )}
        </section>
      )}

      {totals.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">심는 작물</h2>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-white text-sm">
            {totals.map(([cropId, n]) => (
              <li key={cropId} className="flex items-center gap-3 px-4 py-3">
                <span className="h-3 w-3 rounded-full" style={{ background: toneOf(cropId) }} />
                <span className="font-medium">{cropNames[cropId]}</span>
                <span className="ml-auto text-muted">{n}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {warned.size > 0 && (
        <p className="rounded-xl border border-danger-line bg-danger-soft p-3 text-sm text-danger">
          연작 주의 {warned.size}곳 · 지난 작기에 같은 과(科)를 심은 자리예요. 빨간 테두리를 확인하세요.
        </p>
      )}

      <ConfirmPanel
        planId={data.plan.id}
        status={status}
        userId={data.userId}
        memberIds={data.memberIds}
        approvedIds={approvedIds}
        onChanged={refresh}
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

      {picker && (
        <CropPicker
          crops={data.crops}
          tags={data.tags}
          companions={data.companions}
          heatPicks={data.heatPicks}
          selected={picker === "change" ? (bp?.crop_id ?? null) : null}
          onSelect={(id) => {
            const which = picker;
            setPicker(null);
            if (which === "new") void plant(id);
            else if (bp && bed) {
              const sw = data.sowing[id];
              const allowed = patternsFor(sw);
              const method = allowed.includes(bp.method) ? bp.method : allowed[0] === "plant" ? "plant" : (sw?.pattern ?? "row");
              void savePlanting({ ...bp, crop_id: id, method, rows: rowsFor(bed, method, sw, bp.rows), plant_count: null });
            }
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

// 폭 70cm 이상 두둑은 기본 두 줄
const bedWithRows = (b: Bed) => (Math.min(b.w_cm, b.h_cm) >= 70 ? 2 : 1);

function NumberField({ label, value, onCommit, suffix = "cm", disabled = false }: { label: string; value: number; onCommit: (v: number) => void; suffix?: string; disabled?: boolean }) {
  const [text, setText] = useState(String(value));
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setText(String(value));
  }
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <span className="flex h-10 items-center rounded-lg border border-line bg-white px-2">
        <input
          className="w-full bg-transparent text-base text-foreground outline-none"
          inputMode="numeric"
          disabled={disabled}
          value={text}
          onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ""))}
          onBlur={() => {
            const n = Number(text);
            if (text !== "" && n !== value) onCommit(n);
            else setText(String(value));
          }}
        />
        <span className="text-xs text-muted">{suffix}</span>
      </span>
    </label>
  );
}

function BedPanel({
  bed,
  onSave,
  onDuplicate,
  onRemove,
  busy,
}: {
  bed: Bed;
  onSave: (b: Bed) => void;
  onDuplicate: (dir: "right" | "down", gap: number) => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const [gap, setGap] = useState(40);
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{bed.kind === "plot" ? "네모 밭" : "두둑"}</h2>
        <div className="flex rounded-lg bg-[#f0f0ee] p-0.5 text-xs">
          {(["bed", "plot"] as const).map((k) => (
            <button key={k} onClick={() => onSave({ ...bed, kind: k })} className={`h-7 rounded-md px-3 ${bed.kind === k ? "bg-white shadow-sm" : "text-muted"}`}>
              {k === "bed" ? "두둑" : "네모 밭"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="가로" value={bed.w_cm} onCommit={(v) => onSave({ ...bed, w_cm: v })} />
        <NumberField label="세로" value={bed.h_cm} onCommit={(v) => onSave({ ...bed, h_cm: v })} />
        <NumberField label="왼쪽에서" value={bed.x_cm} onCommit={(v) => onSave({ ...bed, x_cm: v })} />
        <NumberField label="위에서" value={bed.y_cm} onCommit={(v) => onSave({ ...bed, y_cm: v })} />
      </div>
      <div className="flex items-end gap-2">
        <div className="w-24">
          <NumberField label="고랑 폭" value={gap} onCommit={setGap} />
        </div>
        <button disabled={busy} onClick={() => onDuplicate("right", gap)} className="h-10 flex-1 rounded-lg border border-line text-sm">
          오른쪽에 복제
        </button>
        <button disabled={busy} onClick={() => onDuplicate("down", gap)} className="h-10 flex-1 rounded-lg border border-line text-sm">
          아래에 복제
        </button>
      </div>
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => onSave({ ...bed, w_cm: bed.h_cm, h_cm: bed.w_cm })} className="h-10 flex-1 rounded-lg border border-line text-sm">
          가로·세로 돌리기
        </button>
        <button disabled={busy} onClick={onRemove} className="h-10 flex-1 rounded-lg border border-danger-line text-sm text-danger">
          구획 지우기
        </button>
      </div>
    </section>
  );
}

function PlantingPanel({
  bed,
  planting,
  cropName,
  tone,
  spacing,
  sowing,
  editable,
  warned,
  onSave,
  onChangeCrop,
  onRemove,
}: {
  bed: Bed;
  planting: BedPlanting;
  cropName: string;
  tone: string;
  spacing: number | null;
  sowing: Sowing | undefined;
  editable: boolean;
  warned: boolean;
  onSave: (p: BedPlanting) => void;
  onChangeCrop: () => void;
  onRemove: () => void;
}) {
  const len = bedLength(bed);
  const auto = autoPlantCount(bed, planting, spacing);
  const count = planting.plant_count ?? auto;
  const patterns = patternsFor(sowing);
  const method = planting.method;
  const rowSpacing = sowing?.rowSpacing ?? null;
  const autoRows = autoRowCount(bed, rowSpacing ?? FALLBACK_ROW_SPACING) ?? 1;
  const choose = (m: SowPattern) => onSave({ ...planting, method: m, rows: rowsFor(bed, m, sowing, planting.rows), plant_count: null });
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-medium">
          <span className="h-3 w-3 rounded-full" style={{ background: tone }} />
          {cropName}
          {planting.carried_from_planting_id && <span className="text-xs text-muted">(이월 · 잠금)</span>}
        </span>
        {editable && (
          <button className="text-sm text-primary" onClick={onChangeCrop}>
            작물 바꾸기
          </button>
        )}
      </div>
      {warned && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">연작 주의 · 지난 작기에 같은 과를 심은 자리예요.</p>}
      {patterns.length > 1 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">심는 방법</span>
          <div className={`grid gap-1 ${patterns.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
            {patterns.map((m) => (
              <button
                key={m}
                disabled={!editable}
                onClick={() => choose(m)}
                className={`h-9 rounded-lg border text-sm ${method === m ? "border-primary bg-primary-soft font-medium text-primary" : "border-line"}`}
              >
                {SOW_PATTERN_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
      )}
      {bed.kind === "bed" && method === "row" && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">줄 수</span>
          <div className="flex items-center gap-2">
            <button
              disabled={!editable || planting.rows <= 1}
              onClick={() => onSave({ ...planting, rows: planting.rows - 1 })}
              className="h-9 w-10 rounded-lg border border-line text-lg disabled:opacity-40"
              aria-label="한 줄 빼기"
            >
              −
            </button>
            <span className="min-w-14 text-center font-medium">{planting.rows}줄</span>
            <button
              disabled={!editable || planting.rows >= 12}
              onClick={() => onSave({ ...planting, rows: planting.rows + 1 })}
              className="h-9 w-10 rounded-lg border border-line text-lg disabled:opacity-40"
              aria-label="한 줄 더하기"
            >
              +
            </button>
            {editable && planting.rows !== autoRows && (
              <button className="ml-auto h-9 rounded-lg border border-line px-3 text-sm" onClick={() => onSave({ ...planting, rows: autoRows })}>
                적정({autoRows}줄)
              </button>
            )}
          </div>
          <p className="text-xs text-muted">
            {rowSpacing
              ? `두둑 폭 ${bedWidth(bed)}cm ÷ 적정 줄간격 ${rowSpacing}cm = ${autoRows}줄`
              : `작물 백과에 줄간격이 없어 ${FALLBACK_ROW_SPACING}cm로 계산했어요 (${autoRows}줄).`}
          </p>
        </div>
      )}
      {method === "broadcast" && (
        <p className="rounded-lg border border-line px-3 py-2 text-xs text-muted">
          흩어뿌림 · 구간 전체에 고르게 뿌려요. 싹이 나면 솎아 간격을 맞춰요.
        </p>
      )}
      {bed.kind === "bed" && countsPlants(method) && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">{method === "hill" ? "몇 줄 점뿌림" : "몇 줄 심기"}</span>
          <div className="grid grid-cols-4 gap-1">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                disabled={!editable}
                onClick={() => onSave({ ...planting, rows: n, plant_count: null })}
                className={`h-9 rounded-lg border text-sm ${planting.rows === n ? "border-primary bg-primary-soft font-medium text-primary" : "border-line"}`}
              >
                {n}줄
              </button>
            ))}
          </div>
          {planting.rows > 1 && (
            <div className="mt-1 grid grid-cols-2 gap-1">
              {(
                [
                  ["parallel", "나란히"],
                  ["staggered", "엇갈려 (지그재그)"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  disabled={!editable}
                  onClick={() => onSave({ ...planting, layout: v })}
                  className={`h-9 rounded-lg border text-sm ${planting.layout === v ? "border-primary bg-primary-soft font-medium text-primary" : "border-line"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {bed.kind === "bed" && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField label={`시작 (0~${len})`} value={planting.start_cm} disabled={!editable} onCommit={(v) => onSave({ ...planting, start_cm: Math.min(v, len - 5), plant_count: null })} />
          <NumberField
            label="길이"
            value={planting.length_cm ?? len - planting.start_cm}
            disabled={!editable}
            onCommit={(v) => onSave({ ...planting, length_cm: v >= len - planting.start_cm ? null : Math.max(5, v), plant_count: null })}
          />
        </div>
      )}
      {countsPlants(method) && (
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <NumberField label={method === "hill" ? "구멍 수" : "포기 수"} value={count ?? 0} suffix="포기" disabled={!editable} onCommit={(v) => onSave({ ...planting, plant_count: v })} />
        </div>
        {editable && planting.plant_count !== null && auto !== null && (
          <button className="h-10 rounded-lg border border-line px-3 text-sm" onClick={() => onSave({ ...planting, plant_count: null })}>
            자동({auto})
          </button>
        )}
      </div>
      )}
      {countsPlants(method) && (
        <p className="text-xs text-muted">
          {spacing ? `포기 간격 ${spacing}cm 기준으로 자동 계산해요.` : "작물 백과에 포기 간격이 없어 포기 수를 직접 입력하세요."}
        </p>
      )}
      {editable && (
        <button className="h-10 rounded-lg border border-danger-line text-sm text-danger" onClick={onRemove}>
          이 작물 빼기
        </button>
      )}
    </div>
  );
}
