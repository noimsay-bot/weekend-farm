// 기상청 공공데이터포털 API (서버 전용). 중기예보는 쓰지 않는다.
import type { HourlyForecast } from "./recommend";

const BASE = "https://apis.data.go.kr/1360000";

async function getJson(url: string, retries = 3): Promise<unknown> {
  let err: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      // 오류 시 XML(OpenAPI_ServiceResponse)로 오는 경우가 있다
      if (text.trim().startsWith("<")) throw new Error(`KMA error: ${text.slice(0, 200)}`);
      return JSON.parse(text);
    } catch (e) {
      err = e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw err;
}

type Items<T> = { response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: { item?: T[] } | "" } } };

function items<T>(doc: unknown): T[] {
  const d = doc as Items<T>;
  const code = d.response?.header?.resultCode;
  if (code && code !== "00" && code !== "03") throw new Error(`KMA ${code}: ${d.response?.header?.resultMsg}`);
  const body = d.response?.body?.items;
  return body && typeof body === "object" ? (body.item ?? []) : [];
}

const ymd = (date: string) => date.replaceAll("-", "");
const dash = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

// PCP: "강수없음", "1mm 미만", "1.0mm", "30.0~50.0mm", "50.0mm 이상"
export function parsePcp(v: string): number {
  if (!v || v.includes("없음")) return 0;
  if (v.includes("미만")) return 0.5;
  const nums = [...v.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  return nums.length ? nums[0] : 0;
}

// 단기예보: 그날 05시 발표분(05:10 이후 제공)을 쓴다. 이르면 전날 23시 발표분.
export async function fetchShortTermForecast(serviceKey: string, nx: number, ny: number, todayKst: string, hourKst: number): Promise<HourlyForecast[]> {
  const [baseDate, baseTime] = hourKst >= 6 ? [todayKst, "0500"] : [addDay(todayKst, -1), "2300"];
  const url =
    `${BASE}/VilageFcstInfoService_2.0/getVilageFcst?serviceKey=${encodeURIComponent(serviceKey)}` +
    `&numOfRows=1500&pageNo=1&dataType=JSON&base_date=${ymd(baseDate)}&base_time=${baseTime}&nx=${nx}&ny=${ny}`;
  const rows = items<{ category: string; fcstDate: string; fcstTime: string; fcstValue: string }>(await getJson(url));
  const by = new Map<string, HourlyForecast>();
  for (const r of rows) {
    if (!["POP", "PCP", "TMP"].includes(r.category)) continue;
    const key = `${r.fcstDate}${r.fcstTime}`;
    const h = by.get(key) ?? { fcst_date: dash(r.fcstDate), fcst_hour: Number(r.fcstTime.slice(0, 2)), pop: null, pcp_mm: null, tmp_c: null };
    if (r.category === "POP") h.pop = Number(r.fcstValue);
    if (r.category === "PCP") h.pcp_mm = parsePcp(r.fcstValue);
    if (r.category === "TMP") h.tmp_c = Number(r.fcstValue);
    by.set(key, h);
  }
  return [...by.values()];
}

export type Alert = {
  region_code: string;
  alert_type: string;
  level: string | null;
  action: string | null;
  announced_at: string;
  raw: Record<string, unknown>;
};

// "[특보] 제05-3호 : 2026.07.10.14:00 / 호우주의보 발표(*)"
export function parseAlertTitle(title: string): { type: string; level: string | null; action: string | null }[] {
  const out: { type: string; level: string | null; action: string | null }[] = [];
  for (const m of title.matchAll(/(호우|대설|한파|폭염|태풍|강풍|풍랑|건조|황사|폭풍해일)(주의보|경보)?\s*(발표|해제|변경|연장)?/g)) {
    out.push({ type: m[1], level: m[2] ?? null, action: m[3] ?? null });
  }
  return out;
}

export async function fetchWarnings(serviceKey: string, officeId: string, fromDate: string, toDate: string): Promise<Alert[]> {
  const url =
    `${BASE}/WthrWrnInfoService/getWthrWrnList?serviceKey=${encodeURIComponent(serviceKey)}` +
    `&numOfRows=100&pageNo=1&dataType=JSON&stnId=${officeId}&fromTmFc=${ymd(fromDate)}&toTmFc=${ymd(toDate)}`;
  const rows = items<{ stnId: string; title: string; tmFc: string; tmSeq: string }>(await getJson(url));
  const out: Alert[] = [];
  for (const r of rows) {
    const t = String(r.tmFc);
    const announced = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}:00+09:00`;
    for (const a of parseAlertTitle(r.title)) {
      out.push({ region_code: officeId, alert_type: a.type, level: a.level, action: a.action, announced_at: announced, raw: r });
    }
  }
  return out;
}

export type DailyObservation = { station_id: string; obs_date: string; rain_mm: number | null; min_temp_c: number | null; max_temp_c: number | null };

export async function fetchAsosDaily(serviceKey: string, stationId: string, from: string, to: string): Promise<DailyObservation[]> {
  const url =
    `${BASE}/AsosDalyInfoService/getWthrDataList?serviceKey=${encodeURIComponent(serviceKey)}` +
    `&numOfRows=400&pageNo=1&dataType=JSON&dataCd=ASOS&dateCd=DAY&startDt=${ymd(from)}&endDt=${ymd(to)}&stnIds=${stationId}`;
  const rows = items<{ tm: string; sumRn: string; minTa: string; maxTa: string }>(await getJson(url));
  const num = (v: string) => (v === "" || v === undefined || v === null ? null : Number(v));
  return rows.map((r) => ({
    station_id: stationId,
    obs_date: r.tm,
    // 강수 없음은 빈 값으로 온다
    rain_mm: r.sumRn === "" ? 0 : num(r.sumRn),
    min_temp_c: num(r.minTa),
    max_temp_c: num(r.maxTa),
  }));
}

function addDay(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
