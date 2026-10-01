// 작물 백과사전 자료 형식 (data/crops/<작물>.json) 과 검사.
// 규칙: 모든 수치는 refs의 출처를 가리켜야 하고, 핵심 수치(KEY_FIELDS)는 출처 2곳 이상이어야 한다.
// 모르는 값은 value: null 로 두고 evidence에 이유를 적는다 (앱에서 '모름'으로 처리).
import { OPTIONAL_CROP_FIELDS, REQUIRED_CROP_FIELDS, type CropFieldDef } from "../../src/lib/crop-fields";

export type Confidence = "high" | "medium" | "low";
export type FieldValue = string | number | boolean | null;

export type CropField = {
  value: FieldValue;
  confidence: Confidence;
  refs: string[];
  evidence: string; // 근거 요약 (출처 간 차이가 있으면 함께 적는다)
};

export type CropRef = { key: string; kind: "doc" | "video"; title: string; url: string; publisher?: string; summary?: string };

export type CropCalendar = {
  region: "전국" | "중부" | "남부" | "제주";
  cropping_type: string; // 예: 가을 재배, 월동 재배 ('' 가능)
  activity: "sow" | "transplant" | "harvest";
  start: string; // MM-DD
  end: string; // MM-DD
  refs: string[];
};

export type CropFertilizer = {
  base?: { compost_kg_per_10a: number | null; lime_kg_per_10a: number | null; note: string; refs: string[] };
  top_dressing?: { days_after_planting: number; note: string; refs: string[] }[];
};

// 재배법: summary(핵심 1~4줄)만 먼저 보이고 body는 '더보기'.
export type CropGuide = { section: GuideSection; summary: string[]; body: string; refs: string[] };

// 파종·정식 기온 기준. 가을 작형은 일평균기온이 from_c에서 to_c로 내려가는 동안(falling), 봄 작형은 올라가는 동안(rising).
// basis: source = 출처가 기온을 직접 말함, normal = 출처의 관행 날짜를 김포 평년 일평균기온(data/climate)으로 환산.
export type CropTempWindow = {
  cropping_type: string;
  activity: "sow" | "transplant";
  trend: "falling" | "rising";
  from_c: number;
  to_c: number;
  basis: "source" | "normal";
  note: string;
  refs: string[];
};

export const GUIDE_SECTIONS = ["소개", "밭 준비", "파종·정식", "관리", "병해충", "수확", "보관", "자주 하는 실수"] as const;
export type GuideSection = (typeof GUIDE_SECTIONS)[number];

export type CropDoc = {
  name: string;
  category: string;
  // 직파 작물의 기본 파종 방식: row 줄뿌림 / hill 점뿌림 / broadcast 흩어뿌림
  sow_pattern?: "row" | "hill" | "broadcast";
  summary: string;
  family: CropField; // 과 이름 (예: 십자화과)
  fields: Record<string, CropField>;
  calendars: CropCalendar[];
  fertilizer?: CropFertilizer;
  temp_windows?: CropTempWindow[];
  guides: CropGuide[];
  refs: CropRef[];
};

// 일정 계산에 직접 쓰이는 값: 출처 2곳 이상
export const KEY_FIELDS = ["days_to_harvest", "plant_spacing_cm", "row_spacing_cm", "min_temp_c", "max_temp_c", "seedling_days"];

const RANGES: Record<string, [number, number]> = {
  seedling_days: [5, 120],
  min_temp_c: [-15, 30],
  max_temp_c: [5, 45],
  days_to_harvest: [10, 400],
  harvest_window_days: [0, 120],
  rest_seasons: [0, 10],
  rain_wait_days: [0, 14],
  schedule_tolerance_days: [0, 30],
  plant_spacing_cm: [1, 200],
  row_spacing_cm: [1, 300],
  plants_per_pyeong: [0.5, 2000],
  watering_interval_days: [1, 30],
};

// family_id는 family로, description·source_url은 summary·refs로 따로 받는다
export const FIELD_DEFS = new Map<string, CropFieldDef>(
  [...REQUIRED_CROP_FIELDS, ...OPTIONAL_CROP_FIELDS]
    .filter((f) => !["family_id", "description", "source_url"].includes(f.name))
    .map((f) => [f.name, f]),
);

const mmdd = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function validateCropDoc(doc: CropDoc): string[] {
  const errors: string[] = [];
  const refKeys = new Set(doc.refs.map((r) => r.key));
  const checkRefs = (where: string, refs: string[], min = 1) => {
    if (!Array.isArray(refs) || refs.length < min) errors.push(`${where}: 출처 ${min}곳 이상 필요`);
    for (const r of refs ?? []) if (!refKeys.has(r)) errors.push(`${where}: 없는 출처 키 ${r}`);
  };

  if (!doc.name?.trim()) errors.push("name 없음");
  if (!doc.summary?.trim()) errors.push("summary 없음");
  if (doc.sow_pattern !== undefined && !["row", "hill", "broadcast"].includes(doc.sow_pattern)) errors.push("sow_pattern: row/hill/broadcast 중 하나");
  if (new Set(doc.refs.map((r) => r.key)).size !== doc.refs.length) errors.push("refs: 키 중복");
  for (const r of doc.refs) {
    if (!/^https?:\/\//.test(r.url)) errors.push(`refs.${r.key}: url 형식`);
    if (r.kind === "video" && !r.summary) errors.push(`refs.${r.key}: 영상은 요약 필요`);
  }

  if (doc.family.value !== null) checkRefs("family", doc.family.refs);

  for (const def of REQUIRED_CROP_FIELDS) {
    if (def.name !== "family_id" && !(def.name in doc.fields)) errors.push(`fields.${def.name}: 빠짐 (모르면 value: null)`);
  }
  for (const [name, f] of Object.entries(doc.fields)) {
    const def = FIELD_DEFS.get(name);
    if (!def) {
      errors.push(`fields.${name}: 알 수 없는 필드`);
      continue;
    }
    if (!["high", "medium", "low"].includes(f.confidence)) errors.push(`fields.${name}: confidence`);
    if (!f.evidence?.trim()) errors.push(`fields.${name}: evidence 없음`);
    if (f.value === null) continue;
    checkRefs(`fields.${name}`, f.refs, KEY_FIELDS.includes(name) ? 2 : 1);
    if ((def.kind === "int" || def.kind === "number") && typeof f.value !== "number") errors.push(`fields.${name}: 숫자여야 함`);
    if (def.kind === "int" && typeof f.value === "number" && !Number.isInteger(f.value)) errors.push(`fields.${name}: 정수여야 함`);
    if (def.kind === "bool" && typeof f.value !== "boolean") errors.push(`fields.${name}: true/false`);
    if (def.kind === "enum" && !def.options!.some((o) => o.value === f.value)) errors.push(`fields.${name}: ${def.options!.map((o) => o.value).join("|")}`);
    const range = RANGES[name];
    if (range && typeof f.value === "number" && (f.value < range[0] || f.value > range[1])) errors.push(`fields.${name}: 범위 ${range[0]}~${range[1]}`);
  }
  const min = doc.fields.min_temp_c?.value, max = doc.fields.max_temp_c?.value;
  if (typeof min === "number" && typeof max === "number" && min >= max) errors.push("min_temp_c < max_temp_c 이어야 함");

  const seen = new Set<string>();
  for (const [i, c] of doc.calendars.entries()) {
    const key = `${c.region}|${c.cropping_type}|${c.activity}`;
    if (seen.has(key)) errors.push(`calendars[${i}]: ${key} 중복`);
    seen.add(key);
    if (!mmdd.test(c.start) || !mmdd.test(c.end)) errors.push(`calendars[${i}]: 날짜는 MM-DD`);
    checkRefs(`calendars[${i}]`, c.refs);
  }

  if (doc.fertilizer?.base) checkRefs("fertilizer.base", doc.fertilizer.base.refs);
  for (const [i, t] of (doc.fertilizer?.top_dressing ?? []).entries()) checkRefs(`fertilizer.top_dressing[${i}]`, t.refs);

  for (const [i, w] of (doc.temp_windows ?? []).entries()) {
    if (!["sow", "transplant"].includes(w.activity)) errors.push(`temp_windows[${i}]: activity`);
    if (w.trend === "falling" ? !(w.from_c > w.to_c) : !(w.from_c < w.to_c)) errors.push(`temp_windows[${i}]: ${w.trend}이면 from/to 방향이 맞아야 함`);
    if (w.from_c < -10 || w.from_c > 35 || w.to_c < -10 || w.to_c > 35) errors.push(`temp_windows[${i}]: 기온 범위`);
    if (!w.note?.trim()) errors.push(`temp_windows[${i}]: note 없음`);
    checkRefs(`temp_windows[${i}]`, w.refs);
  }

  for (const g of doc.guides) {
    if (!GUIDE_SECTIONS.includes(g.section)) errors.push(`guides: 알 수 없는 섹션 ${g.section}`);
    if (!Array.isArray(g.summary) || g.summary.length < 1 || g.summary.length > 4) errors.push(`guides.${g.section}: 핵심(summary) 1~4줄`);
    for (const line of g.summary ?? []) if (line.length > 70) errors.push(`guides.${g.section}: 핵심 한 줄은 70자 이내 (${line.slice(0, 20)}…)`);
    if (!g.body.trim()) errors.push(`guides.${g.section}: 본문 없음`);
    checkRefs(`guides.${g.section}`, g.refs);
  }
  if (new Set(doc.guides.map((g) => g.section)).size !== doc.guides.length) errors.push("guides: 섹션 중복");
  return errors;
}
