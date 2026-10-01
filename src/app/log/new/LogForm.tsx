"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { regenerateTasks } from "@/lib/planting/tasks";
import { resizePhoto } from "@/lib/image";
import { harvestIntervalWarnings, resistanceWarnings } from "@/lib/pesticide";
import { USER_WORK_TYPES, WORK_TYPE_LABEL, type WorkType } from "@/lib/work-types";
import { Button, ErrorText } from "@/components/ui";

export type TargetCrop = { id: string; crop_id: string; crop_name: string; is_companion: boolean };
export type PestOption = {
  id: string;
  crop_id: string;
  pest_name: string;
  ingredient_name: string;
  moa_code: string | null;
  is_organic: boolean;
  safe_days_before_harvest: number | null;
};

// 파종·정식 기록용: 고를 수 있는 작물(백과)과 계획만 하고 아직 안 심은 식재
export type CropOption = { id: string; name: string };
export type UnsownPlanting = { id: string; crop_id: string; crop_name: string; season_label: string };
type PlantingChoice = { plantingId: string | null; cropId: string };

const isPlantingType = (t: WorkType) => t === "sowing" || t === "transplanting";

type PestContext = {
  previous: { planCropId: string; cropId: string; cropName: string; moas: string[] }[];
  harvests: { cropId: string; cropName: string; date: string }[];
};

export function LogForm({
  farmId,
  initialDate,
  targets,
  pests,
  crops,
  unsown = [],
  hasBeds = false,
  onSaved,
}: {
  farmId: string;
  initialDate: string;
  targets: TargetCrop[];
  pests: PestOption[];
  crops?: CropOption[];
  unsown?: UnsownPlanting[];
  hasBeds?: boolean;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [date, setDate] = useState(initialDate);
  const [type, setType] = useState<WorkType>("watering");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [memo, setMemo] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [pesticides, setPesticides] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [planting, setPlanting] = useState<PlantingChoice | null>(null);
  const [plantCount, setPlantCount] = useState("");
  const [cropQuery, setCropQuery] = useState("");
  // 백과 작물 목록이 있으면(기록 탭) 파종·정식은 작물을 골라 식재를 만든다
  const plantingMode = isPlantingType(type) && crops !== undefined;

  const [pestContext, setPestContext] = useState<PestContext>({ previous: [], harvests: [] });

  const chosenCropIds = new Set(targets.filter((t) => chosen.has(t.id)).map((t) => t.crop_id));
  // 같은 성분은 한 번만 보여준다 (작물마다 등록 행이 있음)
  const pestChoices = [...new Map(pests.filter((p) => chosenCropIds.has(p.crop_id)).map((p) => [p.ingredient_name, p])).values()];

  // 방제: 고른 작물의 직전 방제 작용기작과 수확 예정일을 불러온다
  const chosenKey = [...chosen].sort().join(",");
  useEffect(() => {
    if (type !== "pest_control" || !chosenKey) return;
    const ids = chosenKey.split(",");
    const supabase = createClient();
    Promise.all([
      supabase
        .from("work_log_targets")
        .select("plan_crop_id, work_logs!inner(work_date, work_type, work_log_pesticides(crop_pest_controls(crop_id, moa_code)))")
        .in("plan_crop_id", ids)
        .eq("work_logs.work_type", "pest_control")
        .order("work_date", { referencedTable: "work_logs", ascending: false }),
      supabase.from("tasks").select("plan_crop_id, calculated_date, adjusted_date").in("plan_crop_id", ids).eq("task_type", "harvest").eq("status", "pending"),
    ]).then(([logs, tasks]) => {
      const rows = (logs.data ?? []) as unknown as {
        plan_crop_id: string;
        work_logs: { work_date: string; work_log_pesticides: { crop_pest_controls: { crop_id: string; moa_code: string | null } }[] };
      }[];
      const byCrop = new Map(targets.map((t) => [t.id, t]));
      const latest = new Map<string, (typeof rows)[number]>();
      for (const r of rows) {
        const cur = latest.get(r.plan_crop_id);
        if (!cur || r.work_logs.work_date > cur.work_logs.work_date) latest.set(r.plan_crop_id, r);
      }
      setPestContext({
        previous: [...latest.values()].map((r) => ({
          planCropId: r.plan_crop_id,
          cropId: byCrop.get(r.plan_crop_id)?.crop_id ?? "",
          cropName: byCrop.get(r.plan_crop_id)?.crop_name ?? "",
          moas: r.work_logs.work_log_pesticides.map((p) => p.crop_pest_controls.moa_code).filter(Boolean) as string[],
        })),
        harvests: (tasks.data ?? []).map((t) => ({
          cropId: byCrop.get(t.plan_crop_id)?.crop_id ?? "",
          cropName: byCrop.get(t.plan_crop_id)?.crop_name ?? "",
          date: t.adjusted_date ?? t.calculated_date,
        })),
      });
    });
  }, [type, chosenKey, targets]);

  const selectedIngredients = pests
    .filter((p) => chosenCropIds.has(p.crop_id) && pestChoices.some((c) => pesticides.has(c.id) && c.ingredient_name === p.ingredient_name))
    .map((p) => ({ ingredient: p.ingredient_name, moa: p.moa_code, safeDays: p.safe_days_before_harvest, cropId: p.crop_id }));
  const pestWarnings =
    type === "pest_control"
      ? [...harvestIntervalWarnings(selectedIngredients, date, pestContext.harvests), ...resistanceWarnings(selectedIngredients, pestContext.previous)]
      : [];

  function toggle(set: Set<string>, id: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  // 파종·정식: 식재를 만들거나(기록부터) 계획한 식재에 날짜를 넣고, 작업 기록과 예정 작업을 만든다.
  async function savePlanting() {
    if (!planting) return setError("심은 작물을 고르세요.");
    setBusy(true);
    setError("");
    const supabase = createClient();
    const count = plantCount ? Number(plantCount) : null;
    const { data: plantingId, error: recErr } = await supabase.rpc("record_planting", {
      p_farm_id: farmId,
      p_crop_id: planting.cropId,
      p_date: date,
      p_method: type === "sowing" ? "direct" : "transplant",
      p_plant_count: count,
      p_planting_id: planting.plantingId,
    });
    if (recErr || !plantingId) {
      setBusy(false);
      return setError(
        recErr?.message.includes("plan_not_confirmed")
          ? "이 작기의 계획이 아직 확정 전이에요. 계획을 확정하거나 계획에 작물을 넣은 뒤 기록하세요."
          : "기록하지 못했어요.",
      );
    }
    const { data: pl } = await supabase.from("plantings").select("plan_crop_id, bed_planting_id").eq("id", plantingId).single();
    const { data: claims } = await supabase.auth.getClaims();
    const { data: log, error } = await supabase
      .from("work_logs")
      .insert({ farm_id: farmId, work_date: date, work_type: type, memo: memo.trim() || null, created_by: claims?.claims.sub })
      .select("id")
      .single();
    let partial = Boolean(error || !log);
    if (log && pl) {
      const t = await supabase.from("work_log_targets").insert({ work_log_id: log.id, plan_crop_id: pl.plan_crop_id });
      partial ||= Boolean(t.error);
    }
    try {
      await regenerateTasks(supabase, plantingId);
    } catch {
      partial = true;
    }
    setBusy(false);
    if (partial) return setError("심은 기록은 저장했지만 작업 기록·예정 작업 일부를 만들지 못했어요.");
    // 밭 그림이 있고 아직 자리를 안 정했으면 바로 배치 화면으로
    if (hasBeds && !pl?.bed_planting_id) {
      router.push(`/place/${plantingId}`);
    } else {
      router.push(`/calendar?m=${date.slice(0, 7)}`);
    }
    router.refresh();
  }

  async function save() {
    if (plantingMode) return savePlanting();
    if (targets.length && chosen.size === 0) return setError("대상 작물을 하나 이상 고르세요.");
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { data: claims } = await supabase.auth.getClaims();
    const { data: log, error } = await supabase
      .from("work_logs")
      .insert({ farm_id: farmId, work_date: date, work_type: type, memo: memo.trim() || null, created_by: claims?.claims.sub })
      .select("id")
      .single();
    if (error || !log) {
      setBusy(false);
      return setError("기록하지 못했어요.");
    }

    const steps: PromiseLike<{ error: unknown }>[] = [];
    if (chosen.size) {
      steps.push(supabase.from("work_log_targets").insert([...chosen].map((id) => ({ work_log_id: log.id, plan_crop_id: id }))));
    }
    if (type === "pest_control" && pesticides.size) {
      // 선택한 성분의 작물별 등록 행 모두 연결 (작용기작 연속 사용 판정용)
      const ingredients = new Set(pestChoices.filter((p) => pesticides.has(p.id)).map((p) => p.ingredient_name));
      const rows = pests.filter((p) => chosenCropIds.has(p.crop_id) && ingredients.has(p.ingredient_name));
      steps.push(supabase.from("work_log_pesticides").insert(rows.map((p) => ({ work_log_id: log.id, pest_control_id: p.id }))));
    }
    const results = await Promise.all(steps);

    let photoFailed = false;
    for (const file of photos) {
      try {
        const { blob, width, height } = await resizePhoto(file);
        const path = `${farmId}/${log.id}/${crypto.randomUUID()}.jpg`;
        const up = await supabase.storage.from("work-photos").upload(path, blob, { contentType: "image/jpeg" });
        if (up.error) throw up.error;
        const ins = await supabase.from("work_log_photos").insert({ work_log_id: log.id, storage_path: path, width, height });
        if (ins.error) throw ins.error;
      } catch {
        photoFailed = true;
      }
    }

    setBusy(false);
    if (results.some((r) => r.error) || photoFailed) {
      setError("기록은 저장했지만 일부(대상·성분·사진)를 저장하지 못했어요.");
      return;
    }
    if (onSaved) return onSaved();
    router.push(`/calendar?m=${date.slice(0, 7)}`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <label className="flex flex-col gap-1">
        <span className="font-medium">날짜</span>
        <input type="date" className="h-11 rounded border border-neutral-300 bg-white px-2 text-base" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>

      <div className="flex flex-col gap-1">
        <span className="font-medium">작업 종류</span>
        <div className="grid grid-cols-3 gap-1">
          {USER_WORK_TYPES.map((t) => (
            <button key={t} className={`h-10 rounded ${type === t ? "bg-primary text-white" : "border bg-white"}`} onClick={() => setType(t)}>
              {WORK_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      {plantingMode && (
        <PlantingPicker
          crops={crops ?? []}
          unsown={unsown}
          query={cropQuery}
          onQuery={setCropQuery}
          value={planting}
          onChange={setPlanting}
          verb={type === "sowing" ? "파종" : "정식"}
        />
      )}
      {plantingMode && (
        <label className="flex flex-col gap-1">
          <span className="font-medium">{type === "sowing" ? "포기·구멍 수 (줄뿌림·흩어뿌림은 비워 두세요)" : "포기 수"}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            className="h-11 rounded border border-neutral-300 bg-white px-2 text-base"
            value={plantCount}
            onChange={(e) => setPlantCount(e.target.value)}
          />
        </label>
      )}

      {!plantingMode && (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="font-medium">대상 작물</span>
          {targets.length > 0 && (
            <button
              className="text-primary"
              onClick={() => setChosen(chosen.size === targets.length ? new Set() : new Set(targets.map((t) => t.id)))}
            >
              {chosen.size === targets.length ? "전체 해제" : "전체 선택"}
            </button>
          )}
        </div>
        {targets.length === 0 && <p className="text-neutral-500">재배 중인 작물이 없어요. 계획을 확정하고 심은 날짜를 입력하세요.</p>}
        <div className="flex flex-wrap gap-2">
          {targets.map((t) => (
            <button
              key={t.id}
              className={`rounded-full px-3 py-2 ${chosen.has(t.id) ? "bg-primary text-white" : "border bg-white"}`}
              onClick={() => toggle(chosen, t.id, setChosen)}
            >
              {t.crop_name}
              {t.is_companion ? " (사이)" : ""}
            </button>
          ))}
        </div>
      </div>
      )}

      {type === "pest_control" && (
        <div className="flex flex-col gap-1">
          <span className="font-medium">사용 성분</span>
          {pestChoices.length === 0 && <p className="text-neutral-500">대상 작물을 고르면 등록 성분이 보여요.</p>}
          {pestChoices.map((p) => (
            <label key={p.id} className="flex items-center gap-2 rounded bg-white p-2">
              <input type="checkbox" checked={pesticides.has(p.id)} onChange={() => toggle(pesticides, p.id, setPesticides)} />
              <span>
                {p.ingredient_name}
                <span className="text-xs text-neutral-500"> · 작용기작 {p.moa_code ?? "정보 없음"}{p.is_organic ? " · 친환경" : ""}</span>
              </span>
            </label>
          ))}
          {pestWarnings.map((w) => (
            <p key={w} className="rounded bg-amber-50 p-2 text-xs text-amber-900">
              ⚠ {w}
            </p>
          ))}
          <p className="text-xs text-neutral-500">사용 전 제품 라벨의 등록 작물과 사용법을 확인하세요.</p>
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className="font-medium">메모</span>
        <textarea className="min-h-20 rounded border border-neutral-300 bg-white p-2 text-base" value={memo} onChange={(e) => setMemo(e.target.value)} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-medium">사진</span>
        <input type="file" accept="image/*" multiple onChange={(e) => setPhotos([...(e.target.files ?? [])])} />
        {photos.length > 0 && <span className="text-xs text-neutral-500">{photos.length}장 · 올리기 전에 작게 줄여요</span>}
      </label>

      <ErrorText>{error}</ErrorText>
      <Button onClick={save} disabled={busy}>
        {busy ? "저장 중…" : "기록 저장"}
      </Button>
    </div>
  );
}

function PlantingPicker({
  crops,
  unsown,
  query,
  onQuery,
  value,
  onChange,
  verb,
}: {
  crops: CropOption[];
  unsown: UnsownPlanting[];
  query: string;
  onQuery: (q: string) => void;
  value: PlantingChoice | null;
  onChange: (v: PlantingChoice) => void;
  verb: string;
}) {
  const q = query.trim();
  const shown = q ? crops.filter((c) => c.name.includes(q)) : crops;
  const chip = (on: boolean) => `rounded-full px-3 py-2 ${on ? "bg-primary text-white" : "border bg-white"}`;
  return (
    <div className="flex flex-col gap-3">
      {unsown.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="font-medium">계획한 작물</span>
          <p className="text-xs text-neutral-500">계획에 넣어 둔 작물을 고르면 그 자리에 {verb}한 날짜가 들어가요.</p>
          <div className="flex flex-wrap gap-2">
            {unsown.map((u) => (
              <button key={u.id} className={chip(value?.plantingId === u.id)} onClick={() => onChange({ plantingId: u.id, cropId: u.crop_id })}>
                {u.crop_name}
                <span className="ml-1 text-xs opacity-70">{u.season_label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <span className="font-medium">{unsown.length ? "계획에 없던 작물" : `${verb}한 작물`}</span>
        <p className="text-xs text-neutral-500">기록부터 하고, 밭 그림의 자리는 다음 화면에서 정해요.</p>
        {crops.length > 12 && (
          <input
            className="h-10 rounded border border-neutral-300 bg-white px-2 text-base"
            placeholder="작물 이름 찾기"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
        )}
        <div className="flex flex-wrap gap-2">
          {shown.map((c) => (
            <button key={c.id} className={chip(value?.plantingId === null && value.cropId === c.id)} onClick={() => onChange({ plantingId: null, cropId: c.id })}>
              {c.name}
            </button>
          ))}
          {shown.length === 0 && <p className="text-neutral-500">찾는 작물이 없어요.</p>}
        </div>
      </div>
    </div>
  );
}
