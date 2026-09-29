// 농사로 '텃밭가꾸기' 서술형 본문에서 구조화 필드를 규칙으로 추출한다.
// 원칙: 원문에 적힌 값만 뽑고 근거 문장을 함께 남긴다. 못 뽑으면 값 없이 후보 문장만 남긴다.
import { sentences } from "./text";

export type FieldExtraction = {
  field: string; // crops 컬럼명
  value: string | number | boolean | null; // null이면 후보 문장만 있음
  sourceText: string;
};

export type CalendarExtraction = {
  croppingType: string; // 예: 봄 재배
  activity: "sow" | "transplant" | "harvest";
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
  sourceText: string;
};

export type FertilizerExtraction = {
  stage: "base" | "top_dressing";
  sequence: number;
  daysAfterPlanting: number | null;
  compostKgPer10a: number | null;
  limeKgPer10a: number | null;
  ureaKgPer10a: number | null; // 요소 제품량 (추비 성분 비례 분배용)
  sourceText: string;
};

export type GardenExtraction = {
  fields: FieldExtraction[];
  calendars: CalendarExtraction[];
  fertilizers: FertilizerExtraction[];
};

const num = (s: string) => Number(s.replace(/,/g, ""));

function firstMatch(lines: string[], re: RegExp): { line: string; m: RegExpMatchArray } | null {
  for (const line of lines) {
    const m = line.match(re);
    if (m) return { line, m };
  }
  return null;
}

// 키워드 뒤부터 다음 절 경계(이며/이고/·)까지의 구간
function segmentAfter(line: string, keyword: RegExp): string | null {
  const m = line.match(keyword);
  if (m?.index === undefined) return null;
  const rest = line.slice(m.index + m[0].length);
  return rest.split(/이며|이고|하며|·|\(/)[0];
}

function extractTemperature(lines: string[]): FieldExtraction[] {
  const keyword = /(잘 자라는 온도|생육적온|생육 적온|자라는 온도)/;
  for (const line of lines) {
    if (/결구|싹|발아|모 기르는/.test(line.split(keyword)[0] ?? "")) continue;
    const seg = segmentAfter(line, keyword);
    if (seg === null) continue;
    const temps = [...seg.matchAll(/(\d+(?:\.\d+)?)\s*(?=~|∼|℃|°C)/g)].map((m) => num(m[1]));
    if (temps.length >= 2) {
      return [
        { field: "min_temp_c", value: Math.min(...temps), sourceText: line },
        { field: "max_temp_c", value: Math.max(...temps), sourceText: line },
      ];
    }
    return [
      { field: "min_temp_c", value: null, sourceText: line },
      { field: "max_temp_c", value: null, sourceText: line },
    ];
  }
  return [];
}

function extractSeedlingDays(lines: string[]): FieldExtraction[] {
  const hit = firstMatch(lines, /(모 기르는 기간|육묘일수|육묘 일수|육묘기간|육묘 기간)[^\d]*(\d+)\s*(?:~\s*\d+\s*)?일/);
  if (hit) return [{ field: "seedling_days", value: num(hit.m[2]), sourceText: hit.line }];
  const cand = lines.find((l) => /(씨뿌린|파종한?)\s*후.*(옮겨\s*심|정식|아주심)/.test(l));
  return cand ? [{ field: "seedling_days", value: null, sourceText: cand }] : [];
}

function extractWatering(lines: string[]): FieldExtraction[] {
  const out: FieldExtraction[] = [];
  const interval = firstMatch(lines, /물.*?(\d+)\s*(?:~\s*\d+\s*)?일\s*(간격|마다)/);
  if (interval) out.push({ field: "watering_interval_days", value: num(interval.m[1]), sourceText: interval.line });
  const need = firstMatch(lines, /물\s*주기\s*:\s*(보통|많이|많음|적게|적음)/);
  if (need) {
    const v = need.m[1].startsWith("보통") ? "medium" : need.m[1].startsWith("많") ? "high" : "low";
    out.push({ field: "water_need", value: v, sourceText: need.line });
  }
  if (!interval) {
    const cand = lines.find((l) => /물\s*(주기|을\s*주|을\s*충분|관수)/.test(l));
    if (cand) out.push({ field: "watering_interval_days", value: null, sourceText: cand });
  }
  return out;
}

function extractSpacing(lines: string[]): FieldExtraction[] {
  const out: FieldExtraction[] = [];
  let plant: number | null = null;
  let row: number | null = null;
  let plantSrc = "";
  let rowSrc = "";

  // "60~70×30~40cm", "20×15cm" : 줄 간격 × 포기 간격
  const cross = firstMatch(
    lines,
    /(간격|거리)[^\d]*(\d+)(?:\s*~\s*\d+)?\s*[×xX]\s*(\d+)(?:\s*~\s*\d+)?\s*cm/,
  );
  if (cross) {
    row = num(cross.m[2]);
    plant = num(cross.m[3]);
    rowSrc = plantSrc = cross.line;
  } else {
    // 줄 간격과 포기 간격이 한 문장에 함께 있으면 그 문장을 우선한다 (재배법이 섞이지 않게).
    const both = firstMatch(
      lines,
      /(?:줄\s*사이는?|줄\s*간격은?)[^\d]*(\d+)(?:\s*~\s*\d+)?\s*cm.*?(\d+)\s*cm\s*간격으로/,
    );
    if (both) {
      row = num(both.m[1]);
      plant = num(both.m[2]);
      rowSrc = plantSrc = both.line;
    }
  }
  if (plant === null) {
    const single = firstMatch(lines, /(심는 간격|포기\s*사이|포기\s*간격)[^\d]*(\d+)(?:\s*~\s*\d+)?\s*cm/);
    const every = firstMatch(lines, /(\d+)\s*cm\s*간격으로\s*(?:\d+줄을\s*)?심/);
    if (single) {
      plant = num(single.m[2]);
      plantSrc = single.line;
    } else if (every) {
      plant = num(every.m[1]);
      plantSrc = every.line;
    }
  }
  if (row === null) {
    const rowHit = firstMatch(lines, /(줄\s*사이는?|줄\s*간격은?|골\s*간격)[^\d]*(\d+)(?:\s*~\s*\d+)?\s*cm/);
    if (rowHit) {
      row = num(rowHit.m[2]);
      rowSrc = rowHit.line;
    }
  }

  if (plant !== null) out.push({ field: "plant_spacing_cm", value: plant, sourceText: plantSrc });
  if (row !== null) out.push({ field: "row_spacing_cm", value: row, sourceText: rowSrc });
  if (plant !== null && row !== null) {
    // 1평 = 3.3058㎡ = 33058㎠
    const perPyeong = Math.round((33058 / (plant * row)) * 10) / 10;
    out.push({
      field: "plants_per_pyeong",
      value: perPyeong,
      sourceText: `계산: 3.3㎡ ÷ (${row}cm × ${plant}cm) — 근거: ${plantSrc}`,
    });
  }
  return out;
}

function extractDaysToHarvest(lines: string[]): FieldExtraction[] {
  const hit = firstMatch(
    lines,
    /(정식|파종|심은|아주심기|아주심은|씨뿌린|씨 뿌린)\s*(?:한\s*)?(?:후|뒤)\s*(\d+)\s*(?:~\s*(\d+)\s*)?일/,
  );
  if (hit && /수확|먹|식미/.test(hit.line)) {
    const out: FieldExtraction[] = [{ field: "days_to_harvest", value: num(hit.m[2]), sourceText: hit.line }];
    if (hit.m[3]) {
      out.push({ field: "harvest_window_days", value: num(hit.m[3]) - num(hit.m[2]), sourceText: hit.line });
    }
    return out;
  }
  const cand = lines.find((l) => /수확/.test(l) && /\d+\s*일/.test(l));
  return cand ? [{ field: "days_to_harvest", value: null, sourceText: cand }] : [];
}

function extractSowMethod(lines: string[]): FieldExtraction[] {
  const direct = lines.find((l) => /직파|바로\s*뿌|직접\s*뿌|줄뿌림|흩어\s*뿌/.test(l) && !/육묘상|묘상|트레이/.test(l));
  const transplant = lines.find((l) => /씨 뿌리는 방법\s*:\s*육묘|모종|모 기르|육묘|아주심기|정식/.test(l));
  if (direct && transplant) {
    return [{ field: "sow_method", value: "both", sourceText: `${direct} / ${transplant}` }];
  }
  if (direct) return [{ field: "sow_method", value: "direct", sourceText: direct }];
  if (transplant) return [{ field: "sow_method", value: "transplant", sourceText: transplant }];
  return [];
}

function extractPruning(lines: string[]): FieldExtraction[] {
  const line = lines.find((l) => /곁순|순지르기|가지치기|적심|순\s*따기|잎\s*따기/.test(l));
  if (!line) return [];
  return [
    { field: "pruning_required", value: true, sourceText: line },
    { field: "pruning_method", value: line, sourceText: line },
  ];
}

function extractHeat(lines: string[]): FieldExtraction[] {
  const low = lines.find((l) => /더위에\s*약|고온에\s*약|호냉성/.test(l));
  if (low) return [{ field: "heat_tolerance", value: "low", sourceText: low }];
  const high = lines.find((l) => /더위에\s*강|고온에\s*강|내서성이\s*강/.test(l));
  if (high) return [{ field: "heat_tolerance", value: "high", sourceText: high }];
  const cand = lines.find((l) => /고온|더위|여름.*(저조|약)/.test(l));
  return cand ? [{ field: "heat_tolerance", value: null, sourceText: cand }] : [];
}

function candidates(lines: string[], field: string, re: RegExp): FieldExtraction[] {
  const line = lines.find((l) => re.test(l));
  return line ? [{ field, value: null, sourceText: line }] : [];
}

// "3월초~4월말", "9월 중순", "이듬해 4월중~5월말"
const PART_DAY: Record<string, [number, number]> = {
  초: [1, 10],
  상: [1, 10],
  중: [11, 20],
  하: [21, 31],
  말: [21, 31],
};
const MONTH_PART = /(이듬해\s*)?(\d{1,2})\s*월\s*(초순|상순|중순|하순|초|중|하|말)?/g;

function lastDay(month: number) {
  return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function parseMonthRange(text: string): [number, number, number, number] | null {
  const parts = [...text.matchAll(MONTH_PART)];
  if (parts.length === 0) return null;
  const first = parts[0];
  const last = parts[parts.length - 1];
  const sm = num(first[2]);
  const em = num(last[2]);
  if (sm < 1 || sm > 12 || em < 1 || em > 12) return null;
  const sp = first[3]?.[0];
  const ep = last[3]?.[0];
  const sd = sp ? PART_DAY[sp][0] : 1;
  const ed = ep ? Math.min(PART_DAY[ep][1], lastDay(em)) : lastDay(em);
  return [sm, sd, em, ed];
}

function extractCalendars(lines: string[]): CalendarExtraction[] {
  const out: CalendarExtraction[] = [];
  let croppingType = "";
  const activities: [RegExp, CalendarExtraction["activity"]][] = [
    [/^(파종|씨뿌리기)\s*:/, "sow"],
    [/^(정식|아주심기|모종\s*심기)\s*:/, "transplant"],
    [/^수확\s*:/, "harvest"],
  ];
  for (const line of lines) {
    const type = line.match(/^(봄|여름|가을|겨울|월동|하우스|노지)\s*재배/);
    if (type) {
      croppingType = type[0];
      continue;
    }
    for (const [re, activity] of activities) {
      if (!re.test(line)) continue;
      const range = parseMonthRange(line.replace(re, ""));
      if (range) {
        out.push({
          croppingType,
          activity,
          startMonth: range[0],
          startDay: range[1],
          endMonth: range[2],
          endDay: range[3],
          sourceText: croppingType ? `${croppingType} — ${line}` : line,
        });
      }
    }
  }
  return out;
}

// 면적 기준을 kg/10a 환산 계수로: 값(g) × factor = kg/10a
function areaFactor(text: string): { factor: number; unit: "g" | "kg" } | null {
  if (/kg\s*\/\s*10a/.test(text)) return { factor: 1, unit: "kg" };
  const m = text.match(/(\d+(?:\.\d+)?)\s*㎡\s*(?:기준|당)/);
  if (!m) return null;
  const area = num(m[1]);
  // g/area㎡ → kg/1000㎡
  return { factor: 1000 / area / 1000, unit: "g" };
}

function amount(text: string, name: RegExp, unitDefault: "g" | "kg"): number | null {
  const m = text.match(new RegExp(`${name.source}\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(kg|㎏|g)?`));
  if (!m) return null;
  const v = num(m[1]);
  const unit = m[2] ? (m[2] === "g" ? "g" : "kg") : unitDefault;
  return unit === "kg" ? v * 1000 : v; // g로 통일
}

function extractFertilizers(lines: string[]): FertilizerExtraction[] {
  const out: FertilizerExtraction[] = [];
  // 면적 기준이 적힌 줄 또는 그 뒤 몇 줄을 한 블록으로 본다.
  const idx = lines.findIndex((l) => /거름|비료/.test(l) && areaFactor(l));
  if (idx < 0) return out;
  const basis = areaFactor(lines[idx])!;
  const block = lines.slice(idx, idx + 6).join(" ");
  const toKg10a = (g: number | null) =>
    g === null ? null : Math.round((basis.unit === "kg" ? g / 1000 : g * basis.factor) * 10) / 10;

  const baseText = block.split(/웃거름/)[0];
  out.push({
    stage: "base",
    sequence: 1,
    daysAfterPlanting: null,
    compostKgPer10a: toKg10a(amount(baseText, /퇴비/, basis.unit)),
    limeKgPer10a: toKg10a(amount(baseText, /(?:고토석회|소석회|석회)/, basis.unit)),
    ureaKgPer10a: toKg10a(amount(baseText, /요소/, basis.unit)),
    sourceText: baseText.trim(),
  });

  const top = block.split(/웃거름\s*:?/)[1];
  if (top) {
    const steps = [...top.matchAll(/(?:정식|아주심기|파종)\s*후\s*(\d+)\s*일\s*([^,]*?요소\s*\d[\d,]*\s*g?)/g)];
    steps.forEach((s, i) => {
      out.push({
        stage: "top_dressing",
        sequence: i + 1,
        daysAfterPlanting: num(s[1]),
        compostKgPer10a: null,
        limeKgPer10a: null,
        ureaKgPer10a: toKg10a(amount(s[2], /요소/, basis.unit)),
        sourceText: `웃거름: ${s[0].trim()}`,
      });
    });
  }
  return out;
}

export function extractGarden(text: string): GardenExtraction {
  const lines = sentences(text);
  const fields = [
    ...extractTemperature(lines),
    ...extractSeedlingDays(lines),
    ...extractWatering(lines),
    ...extractSpacing(lines),
    ...extractDaysToHarvest(lines),
    ...extractSowMethod(lines),
    ...extractPruning(lines),
    ...extractHeat(lines),
    ...candidates(lines, "rotation_risk", /연작|이어짓기|지난해\s*심었/),
    ...candidates(lines, "late_frost_sensitive", /늦서리|서리/),
    ...candidates(lines, "harvest_avoid_rain", /수확.*(비|맑은\s*날|건조)/),
  ];
  return { fields, calendars: extractCalendars(lines), fertilizers: extractFertilizers(lines) };
}
