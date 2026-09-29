// 작물 필드 정의. 관리자 확정 화면과 누락 리포트가 쓴다.
// REQUIRED 목록은 DB 함수 crop_required_fields()와 같아야 한다 (테스트로 확인).

export type CropFieldKind = "int" | "number" | "bool" | "text" | "enum" | "family";

export type CropFieldDef = {
  name: string;
  label: string;
  kind: CropFieldKind;
  options?: { value: string; label: string }[];
  unit?: string;
};

const LEVEL = [
  { value: "high", label: "높음" },
  { value: "medium", label: "보통" },
  { value: "low", label: "낮음" },
];

export const REQUIRED_CROP_FIELDS: CropFieldDef[] = [
  { name: "family_id", label: "과(科)", kind: "family" },
  {
    name: "sow_method",
    label: "재배방식",
    kind: "enum",
    options: [
      { value: "direct", label: "직파" },
      { value: "transplant", label: "정식" },
      { value: "both", label: "둘 다" },
    ],
  },
  {
    name: "season",
    label: "작기",
    kind: "enum",
    options: [
      { value: "spring", label: "봄" },
      { value: "autumn", label: "가을" },
      { value: "overwinter", label: "월동" },
      { value: "perennial", label: "여러해살이" },
    ],
  },
  { name: "seedling_days", label: "육묘일수", kind: "int", unit: "일" },
  { name: "min_temp_c", label: "적정 최저기온", kind: "number", unit: "℃" },
  { name: "max_temp_c", label: "적정 최고기온", kind: "number", unit: "℃" },
  { name: "late_frost_sensitive", label: "늦서리 피해", kind: "bool" },
  { name: "days_to_harvest", label: "수확까지 일수", kind: "int", unit: "일" },
  { name: "harvest_window_days", label: "수확 적기 폭", kind: "int", unit: "일" },
  {
    name: "rotation_risk",
    label: "연작위험",
    kind: "enum",
    options: [
      { value: "high", label: "높음" },
      { value: "low", label: "낮음" },
    ],
  },
  { name: "rest_seasons", label: "권장 휴작 작기 수", kind: "int", unit: "작기" },
  {
    name: "overwinter_default",
    label: "월동 점유 기본값",
    kind: "enum",
    options: [
      { value: "keep", label: "유지" },
      { value: "choose", label: "선택" },
    ],
  },
  { name: "harvest_avoid_rain", label: "수확 시 강우 회피", kind: "bool" },
  { name: "rain_wait_days", label: "강우 후 수확 대기", kind: "int", unit: "일" },
  { name: "schedule_tolerance_days", label: "예정일 허용 오차", kind: "int", unit: "일" },
  { name: "plant_spacing_cm", label: "포기 간격", kind: "number", unit: "cm" },
  { name: "row_spacing_cm", label: "줄 간격", kind: "number", unit: "cm" },
  { name: "plants_per_pyeong", label: "평당 표준 포기 수", kind: "number", unit: "포기" },
  { name: "pruning_required", label: "가지치기 대상", kind: "bool" },
  { name: "pruning_method", label: "가지치기 방법", kind: "text" },
  { name: "pruning_timing", label: "가지치기 시기", kind: "text" },
  { name: "heat_tolerance", label: "고온 내성", kind: "enum", options: LEVEL },
  { name: "watering_interval_days", label: "물주기 간격", kind: "int", unit: "일" },
];

export const OPTIONAL_CROP_FIELDS: CropFieldDef[] = [
  { name: "description", label: "설명", kind: "text" },
  { name: "water_need", label: "물 요구도", kind: "enum", options: LEVEL },
  { name: "rain_wait_condition", label: "강우 후 대기 조건", kind: "text" },
  { name: "source_url", label: "출처 URL", kind: "text" },
];

export const ALL_CROP_FIELDS = [...REQUIRED_CROP_FIELDS, ...OPTIONAL_CROP_FIELDS];

export function fieldLabel(name: string): string {
  return ALL_CROP_FIELDS.find((f) => f.name === name)?.label ?? name;
}

export function formatFieldValue(def: CropFieldDef, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (def.kind === "bool") return value === true || value === "true" ? "예" : "아니오";
  if (def.kind === "enum") return def.options?.find((o) => o.value === value)?.label ?? String(value);
  return def.unit ? `${value}${def.unit}` : String(value);
}
