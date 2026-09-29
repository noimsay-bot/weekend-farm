// 식재 날짜로 예정 작업(tasks)을 만든다 (계획서 M3).
// 날짜 계산에 쓰는 수치는 모두 작물 데이터(농사로 기준, 관리자 확정)에서 온다. 없으면 그 작업을 만들지 않는다.
import { addDays } from "./dates";
import { baseFertilizerPlan } from "./units";

export type ScheduleCrop = {
  name: string;
  days_to_harvest: number | null;
  pruning_required: boolean | null;
  pruning_method: string | null;
  pruning_timing: string | null;
  source_url: string | null;
};

export type ScheduleFertilizer = {
  stage: "base" | "top_dressing";
  sequence: number;
  days_after_planting: number | null;
  n_kg_per_10a: number | null;
  p_kg_per_10a: number | null;
  k_kg_per_10a: number | null;
  compost_kg_per_10a: number | null;
  lime_kg_per_10a: number | null;
  source_url: string | null;
};

export type RotationPrevention = {
  familyName: string;
  soilTreatmentIngredients: string[];
  limePhGuide: string | null;
  drainageGuide: string | null;
};

export type ScheduleInput = {
  farmId: string;
  plantingId: string;
  planCropId: string;
  plantedOn: string; // 파종일(직파) 또는 정식일
  method: "direct" | "transplant";
  areaM2: number;
  crop: ScheduleCrop;
  daysToHarvest: number | null; // 품종 값이 있으면 품종 값
  fertilizers: ScheduleFertilizer[];
  rotation: RotationPrevention | null; // 연작 확정 영역이면 예방조치
};

export type TaskDraft = {
  farm_id: string;
  planting_id: string;
  plan_crop_id: string;
  task_type: "field_prep" | "top_dressing" | "pruning" | "harvest";
  title: string;
  calculated_date: string;
  details: Record<string, unknown>;
  source_url: string | null;
};

// "정식 후 20일", "심은 뒤 10~15일" 처럼 날짜가 적힌 가지치기 시기만 쓴다.
export function pruningDays(timing: string | null): number | null {
  const m = timing?.match(/(\d+)\s*(?:~\s*\d+\s*)?일/);
  return m ? Number(m[1]) : null;
}

export function generateTasks(input: ScheduleInput): TaskDraft[] {
  const { crop } = input;
  const verb = input.method === "direct" ? "파종" : "정식";
  const base = { farm_id: input.farmId, planting_id: input.plantingId, plan_crop_id: input.planCropId };
  const tasks: TaskDraft[] = [];

  // 밭만들기: 파종·정식 전까지. 밑거름·석회는 면적으로 환산한다.
  const baseRow = input.fertilizers.find((f) => f.stage === "base");
  const checklist = input.rotation
    ? [
        ...input.rotation.soilTreatmentIngredients.map((i) => `토양 처리 약제 성분: ${i}`),
        ...(input.rotation.limePhGuide ? [`석회·산도: ${input.rotation.limePhGuide}`] : []),
        ...(input.rotation.drainageGuide ? [`배수: ${input.rotation.drainageGuide}`] : []),
      ]
    : [];
  tasks.push({
    ...base,
    task_type: "field_prep",
    title: `${crop.name} 밭만들기 (${verb} 전)`,
    calculated_date: input.plantedOn,
    details: {
      fertilizer: baseRow ? baseFertilizerPlan(baseRow, input.areaM2) : null,
      rotation: input.rotation
        ? {
            family: input.rotation.familyName,
            note: "연작 영역이에요. 아래 예방조치는 토양 병해 피해를 줄입니다.",
            checklist: checklist.length ? checklist : ["이 과의 예방조치 자료가 아직 없어요."],
          }
        : null,
    },
    source_url: baseRow?.source_url ?? crop.source_url,
  });

  // 추비: 시기(정식·파종 후 일수)가 있는 회차만
  for (const f of input.fertilizers.filter((f) => f.stage === "top_dressing" && f.days_after_planting !== null)) {
    tasks.push({
      ...base,
      task_type: "top_dressing",
      title: `${crop.name} ${f.sequence}차 추비`,
      calculated_date: addDays(input.plantedOn, f.days_after_planting!),
      details: {
        reason: `${verb} 후 ${f.days_after_planting}일, ${f.sequence}차 추비 시기`,
        sequence: f.sequence,
        n_kg_per_10a: f.n_kg_per_10a,
        p_kg_per_10a: f.p_kg_per_10a,
        k_kg_per_10a: f.k_kg_per_10a,
      },
      source_url: f.source_url,
    });
  }

  // 가지치기: 시기에 일수가 적혀 있을 때만
  const pd = crop.pruning_required ? pruningDays(crop.pruning_timing) : null;
  if (pd !== null) {
    tasks.push({
      ...base,
      task_type: "pruning",
      title: `${crop.name} 가지치기`,
      calculated_date: addDays(input.plantedOn, pd),
      details: { reason: crop.pruning_timing, method: crop.pruning_method },
      source_url: crop.source_url,
    });
  }

  // 수확 예정
  if (input.daysToHarvest) {
    tasks.push({
      ...base,
      task_type: "harvest",
      title: `${crop.name} 수확 예정`,
      calculated_date: addDays(input.plantedOn, input.daysToHarvest),
      details: { reason: `${verb} 후 ${input.daysToHarvest}일` },
      source_url: crop.source_url,
    });
  }
  return tasks;
}

// 조정 폭이 허용 오차를 넘는지 (경고만)
export function exceedsTolerance(calculated: string, adjusted: string, toleranceDays: number | null): boolean {
  if (toleranceDays === null) return false;
  const diff = Math.abs(Date.parse(adjusted) - Date.parse(calculated)) / 86400000;
  return diff > toleranceDays;
}

// 시차 파종: 칸을 n등분하고 회차별 날짜를 배정한다.
export function splitStaggered<T>(cells: T[], count: number, firstDate: string, intervalDays: number) {
  const n = Math.max(1, Math.min(count, cells.length));
  const size = Math.floor(cells.length / n);
  const extra = cells.length % n;
  const parts: { cells: T[]; date: string }[] = [];
  let i = 0;
  for (let k = 0; k < n; k++) {
    const len = size + (k < extra ? 1 : 0);
    parts.push({ cells: cells.slice(i, i + len), date: addDays(firstDate, k * intervalDays) });
    i += len;
  }
  return parts;
}
