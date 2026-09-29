"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatKDate, inMonthDayRange } from "@/lib/dates";
import { generateTasks, splitStaggered, type ScheduleFertilizer } from "@/lib/schedule";
import { cellsToM2, formatArea } from "@/lib/units";
import { Button, ErrorText } from "@/components/ui";

type Planting = {
  id: string;
  plan_crop_id: string;
  crop_id: string;
  variety_id: string | null;
  method: "direct" | "transplant" | null;
  sow_date: string | null;
  transplant_date: string | null;
  planned_plant_count: number | null;
  plant_count: number | null;
  planting_cells: { cell_id: string; field_plan_cells: { x: number; y: number; rotation_flag: boolean } }[];
  crops: {
    name: string;
    sow_method: "direct" | "transplant" | "both" | null;
    days_to_harvest: number | null;
    pruning_required: boolean | null;
    pruning_method: string | null;
    pruning_timing: string | null;
    source_url: string | null;
    family_id: string | null;
    schedule_tolerance_days: number | null;
  };
};

type Variety = {
  variety_id: string;
  crop_id: string;
  farm_id: string | null;
  name: string;
  days_to_harvest: number | null;
  days_to_harvest_from_variety: boolean;
};

type Calendar = {
  crop_id: string;
  region: string;
  cropping_type: string;
  activity: "sow" | "transplant" | "harvest";
  start_month: number;
  start_day: number;
  end_month: number;
  end_day: number;
};

export type PlantingData = {
  farmId: string;
  region: string | null;
  cellSizeM: number;
  plantings: Planting[];
  varieties: Variety[];
  fertilizers: (ScheduleFertilizer & { crop_id: string })[];
  calendars: Calendar[];
  families: { id: string; name: string; soil_treatment_ingredients: string[] | null; lime_ph_guide: string | null; drainage_guide: string | null }[];
};

// 관행 기간(지역 → 없으면 '전국') 밖이면 경고 문구
export function outsideWindow(date: string, activity: "sow" | "transplant", cropId: string, data: PlantingData): string | null {
  const rows = data.calendars.filter((c) => c.crop_id === cropId && c.activity === activity);
  const regional = rows.filter((c) => c.region === data.region);
  const usable = regional.length ? regional : rows.filter((c) => c.region === "전국");
  if (usable.length === 0) return null;
  if (usable.some((c) => inMonthDayRange(date, c))) return null;
  const ranges = usable.map((c) => `${c.cropping_type ? `${c.cropping_type} ` : ""}${c.start_month}/${c.start_day}~${c.end_month}/${c.end_day}`);
  return `관행 ${activity === "sow" ? "파종" : "정식"} 기간(${ranges.join(", ")})을 벗어나요.`;
}

async function saveSchedule(
  planting: Planting,
  data: PlantingData,
  values: { date: string; method: "direct" | "transplant"; varietyId: string | null; plantCount: number | null },
  cellCount: number,
) {
  const supabase = createClient();
  const { error } = await supabase
    .from("plantings")
    .update({
      method: values.method,
      sow_date: values.method === "direct" ? values.date : null,
      transplant_date: values.method === "transplant" ? values.date : null,
      variety_id: values.varietyId,
      plant_count: values.plantCount,
    })
    .eq("id", planting.id);
  if (error) throw error;

  const variety = data.varieties.find((v) => v.variety_id === values.varietyId);
  const rotationFlag = planting.planting_cells.some((c) => c.field_plan_cells.rotation_flag);
  const family = data.families.find((f) => f.id === planting.crops.family_id);
  const tasks = generateTasks({
    farmId: data.farmId,
    plantingId: planting.id,
    planCropId: planting.plan_crop_id,
    plantedOn: values.date,
    method: values.method,
    areaM2: cellsToM2(cellCount, data.cellSizeM),
    crop: planting.crops,
    daysToHarvest: variety?.days_to_harvest ?? planting.crops.days_to_harvest,
    fertilizers: data.fertilizers.filter((f) => f.crop_id === planting.crop_id),
    rotation:
      rotationFlag && family
        ? {
            familyName: family.name,
            soilTreatmentIngredients: family.soil_treatment_ingredients ?? [],
            limePhGuide: family.lime_ph_guide,
            drainageGuide: family.drainage_guide,
          }
        : null,
  });

  // 계산일이 바뀌므로 대기 중인 자동 작업을 다시 만든다 (완료한 작업은 그대로)
  const del = await supabase.from("tasks").delete().eq("planting_id", planting.id).eq("status", "pending");
  if (del.error) throw del.error;
  if (tasks.length) {
    const ins = await supabase.from("tasks").insert(tasks);
    if (ins.error) throw ins.error;
  }
}

export function PlantingForm({ planting, data }: { planting: Planting; data: PlantingData }) {
  const crop = planting.crops;
  const fixedMethod = crop.sow_method === "direct" || crop.sow_method === "transplant" ? crop.sow_method : null;
  const [method, setMethod] = useState<"direct" | "transplant">(planting.method ?? fixedMethod ?? "transplant");
  const [date, setDate] = useState(planting.transplant_date ?? planting.sow_date ?? "");
  const [varietyId, setVarietyId] = useState(planting.variety_id ?? "");
  const [count, setCount] = useState(String(planting.plant_count ?? planting.planned_plant_count ?? ""));
  const [varieties, setVarieties] = useState(data.varieties.filter((v) => v.crop_id === planting.crop_id));
  const [newVariety, setNewVariety] = useState<{ name: string; days: string } | null>(null);
  const [split, setSplit] = useState<{ interval: string; times: string; dates: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const cellCount = planting.planting_cells.length;
  const area = cellsToM2(cellCount, data.cellSizeM);
  const activity = method === "direct" ? "sow" : "transplant";
  const warning = date ? outsideWindow(date, activity, planting.crop_id, data) : null;
  const selectedVariety = varieties.find((v) => v.variety_id === varietyId);

  async function save() {
    if (!date) return setError("날짜를 입력하세요.");
    setBusy(true);
    setError("");
    try {
      await saveSchedule(planting, data, { date, method, varietyId: varietyId || null, plantCount: count ? Number(count) : null }, cellCount);
      setSaved(true);
    } catch {
      setError("저장하지 못했어요.");
    }
    setBusy(false);
  }

  async function addVariety() {
    if (!newVariety?.name.trim()) return;
    const { data: row, error } = await createClient()
      .from("crop_varieties")
      .insert({
        crop_id: planting.crop_id,
        farm_id: data.farmId,
        name: newVariety.name.trim(),
        days_to_harvest: newVariety.days ? Number(newVariety.days) : null,
        value_source: "user",
      })
      .select("id")
      .single();
    if (error || !row) return setError("품종을 추가하지 못했어요. 같은 이름이 있는지 확인하세요.");
    setVarieties([
      ...varieties,
      {
        variety_id: row.id,
        crop_id: planting.crop_id,
        farm_id: data.farmId,
        name: newVariety.name.trim(),
        days_to_harvest: newVariety.days ? Number(newVariety.days) : crop.days_to_harvest,
        days_to_harvest_from_variety: Boolean(newVariety.days),
      },
    ]);
    setVarietyId(row.id);
    setNewVariety(null);
  }

  function previewSplit(interval: string, times: string, first: string) {
    const n = Number(times);
    const d = Number(interval);
    if (!first || !n || n < 2 || Number.isNaN(d)) return [];
    return splitStaggered(sortedCells(), n, first, d).map((p) => p.date);
  }

  function sortedCells() {
    return [...planting.planting_cells]
      .sort((a, b) => a.field_plan_cells.y - b.field_plan_cells.y || a.field_plan_cells.x - b.field_plan_cells.x)
      .map((c) => c.cell_id);
  }

  async function doSplit() {
    if (!split || split.dates.length < 2) return;
    setBusy(true);
    setError("");
    const parts = splitStaggered(sortedCells(), split.dates.length, split.dates[0], 0);
    const supabase = createClient();
    const { data: ids, error } = await supabase.rpc("split_planting", {
      p_planting_id: planting.id,
      p_parts: parts.map((p) => p.cells),
    });
    if (error || !Array.isArray(ids)) {
      setBusy(false);
      return setError("나누지 못했어요.");
    }
    try {
      for (let i = 0; i < ids.length; i++) {
        await saveSchedule(
          { ...planting, id: ids[i], planting_cells: planting.planting_cells.filter((c) => parts[i].cells.includes(c.cell_id)) },
          data,
          { date: split.dates[i], method, varietyId: varietyId || null, plantCount: null },
          parts[i].cells.length,
        );
      }
    } catch {
      setError("일부 회차의 일정을 저장하지 못했어요.");
    }
    window.location.reload();
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg bg-white p-4 text-sm">
      <div>
        <h2 className="text-base font-semibold">{crop.name}</h2>
        <p className="text-xs text-neutral-500">
          {cellCount}칸 · {formatArea(area)}
          {planting.planned_plant_count !== null && ` · 계획 약 ${planting.planned_plant_count}포기`}
        </p>
      </div>

      {!fixedMethod && (
        <div className="grid grid-cols-2 gap-2">
          {(["direct", "transplant"] as const).map((m) => (
            <button
              key={m}
              className={`h-10 rounded ${method === m ? "bg-primary text-white" : "border"}`}
              onClick={() => setMethod(m)}
            >
              {m === "direct" ? "직파(씨앗)" : "정식(모종)"}
            </button>
          ))}
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className="font-medium">{method === "direct" ? "파종일" : "정식일"}</span>
        <input
          type="date"
          className="h-11 rounded border border-neutral-300 px-2 text-base"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      {warning && <p className="text-xs text-amber-700">⚠ {warning}</p>}

      <label className="flex flex-col gap-1">
        <span className="font-medium">품종 (선택)</span>
        <select
          className="h-11 rounded border border-neutral-300 px-2 text-base"
          value={varietyId}
          onChange={(e) => (e.target.value === "__new" ? setNewVariety({ name: "", days: "" }) : setVarietyId(e.target.value))}
        >
          <option value="">선택 안 함</option>
          {varieties.map((v) => (
            <option key={v.variety_id} value={v.variety_id}>
              {v.name}
            </option>
          ))}
          <option value="__new">+ 목록에 없는 품종 추가</option>
        </select>
      </label>
      {selectedVariety?.days_to_harvest_from_variety && (
        <p className="text-xs text-neutral-600">
          수확까지 {selectedVariety.days_to_harvest}일 <span className="rounded bg-neutral-100 px-1">사용자 입력</span>
        </p>
      )}
      {newVariety && (
        <div className="flex flex-col gap-2 rounded border border-dashed p-2">
          <input
            className="h-10 rounded border px-2"
            placeholder="품종 이름 (예: 청양고추)"
            value={newVariety.name}
            onChange={(e) => setNewVariety({ ...newVariety, name: e.target.value })}
          />
          <input
            className="h-10 rounded border px-2"
            inputMode="numeric"
            placeholder="수확까지 일수 (씨앗 봉투 기준, 선택)"
            value={newVariety.days}
            onChange={(e) => setNewVariety({ ...newVariety, days: e.target.value.replace(/\D/g, "") })}
          />
          <p className="text-xs text-neutral-500">품종 값은 &lsquo;사용자 입력&rsquo;으로 표시돼요. 비우면 작물 값을 써요.</p>
          <div className="flex gap-2">
            <button className="h-10 flex-1 rounded bg-primary text-white" onClick={addVariety}>
              추가
            </button>
            <button className="h-10 rounded border px-3" onClick={() => setNewVariety(null)}>
              취소
            </button>
          </div>
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className="font-medium">실제 포기 수</span>
        <input
          className="h-11 rounded border border-neutral-300 px-2 text-base"
          inputMode="numeric"
          value={count}
          onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))}
        />
        <span className="text-xs text-neutral-500">계획 포기 수로 채워 두었어요. 심은 뒤 언제든 고칠 수 있어요.</span>
      </label>

      <ErrorText>{error}</ErrorText>
      <Button onClick={save} disabled={busy}>
        {saved ? "저장됨 · 다시 저장" : "저장하고 일정 만들기"}
      </Button>

      {cellCount >= 2 && (
        <details
          open={Boolean(split)}
          onToggle={(e) => (e.currentTarget.open ? !split && setSplit({ interval: "14", times: "2", dates: [] }) : setSplit(null))}
        >
          <summary className="cursor-pointer text-primary">시차 파종으로 나누기</summary>
          {split && (
            <div className="mt-2 flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span>간격(일)</span>
                  <input
                    className="h-10 rounded border px-2"
                    inputMode="numeric"
                    value={split.interval}
                    onChange={(e) => {
                      const interval = e.target.value.replace(/\D/g, "");
                      setSplit({ ...split, interval, dates: previewSplit(interval, split.times, date) });
                    }}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span>횟수</span>
                  <input
                    className="h-10 rounded border px-2"
                    inputMode="numeric"
                    value={split.times}
                    onChange={(e) => {
                      const times = e.target.value.replace(/\D/g, "");
                      setSplit({ ...split, times, dates: previewSplit(split.interval, times, date) });
                    }}
                  />
                </label>
              </div>
              {!date && <p className="text-xs text-neutral-500">위에서 첫 회차 날짜를 먼저 입력하세요.</p>}
              {date && split.dates.length === 0 && (
                <button className="h-10 rounded border" onClick={() => setSplit({ ...split, dates: previewSplit(split.interval, split.times, date) })}>
                  회차 만들기
                </button>
              )}
              {split.dates.map((d, i) => {
                const w = outsideWindow(d, activity, planting.crop_id, data);
                return (
                  <div key={i} className="flex flex-col gap-1">
                    <label className="flex items-center gap-2">
                      <span className="w-12 shrink-0">{i + 1}회차</span>
                      <input
                        type="date"
                        className="h-10 flex-1 rounded border px-2"
                        value={d}
                        onChange={(e) => setSplit({ ...split, dates: split.dates.map((x, j) => (j === i ? e.target.value : x)) })}
                      />
                      <span className="text-xs text-neutral-500">{d && formatKDate(d)}</span>
                    </label>
                    {w && <p className="text-xs text-amber-700">⚠ {w}</p>}
                  </div>
                );
              })}
              {split.dates.length >= 2 && (
                <Button variant="secondary" onClick={doSplit} disabled={busy}>
                  {split.dates.length}회로 나누고 저장
                </Button>
              )}
            </div>
          )}
        </details>
      )}
    </section>
  );
}
