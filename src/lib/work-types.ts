export type WorkType =
  | "field_prep"
  | "sowing"
  | "transplanting"
  | "top_dressing"
  | "pest_control"
  | "watering"
  | "pruning"
  | "harvest"
  | "other"
  | "rain";

export const WORK_TYPE_LABEL: Record<WorkType, string> = {
  field_prep: "밭만들기",
  sowing: "파종",
  transplanting: "정식",
  top_dressing: "추비",
  pest_control: "방제",
  watering: "물주기",
  pruning: "가지치기",
  harvest: "수확",
  other: "기타",
  rain: "비",
};

// 사용자가 직접 고를 수 있는 종류 (비는 시스템 자동 기록)
export const USER_WORK_TYPES = (Object.keys(WORK_TYPE_LABEL) as WorkType[]).filter((t) => t !== "rain");
