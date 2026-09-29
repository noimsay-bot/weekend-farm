// OpenStreetMap Nominatim 주소 검색 (무료, 초당 1회 이하 사용 조건).
// Nominatim은 한국 주소의 번지나 "시 읍 리" 전체 조합을 잘 못 찾으므로
// 전체 검색이 실패하면 가장 작은 지명부터 하나씩 검색하고, 나머지 지명이 들어간 결과를 고른다.

export type GeocodeResult = { place_id: number; display_name: string; lat: string; lon: string };

export type GeocodeOutcome = {
  results: GeocodeResult[];
  // 전체 주소가 아니라 일부 지명으로 찾았으면 그 지명
  matchedName: string | null;
};

type Fetcher = (query: string) => Promise<GeocodeResult[]>;

const REQUEST_INTERVAL_MS = 1100;

// 번지("44-1", "산44-1", "123번지")는 지명 검색에 방해가 되므로 뺀다.
export function addressTokens(address: string): string[] {
  return address
    .trim()
    .split(/[\s,]+/)
    .filter((t) => t && !/\d/.test(t));
}

// 결과 이름에 나머지 지명이 몇 개 들어 있는지로 순위를 매긴다. 하나도 없으면 버린다.
export function rankByContext(results: GeocodeResult[], context: string[]): GeocodeResult[] {
  if (context.length === 0) return results;
  const scored = results
    .map((r) => ({ r, score: context.filter((c) => r.display_name.includes(c)).length }))
    .filter((s) => s.score > 0);
  const best = Math.max(0, ...scored.map((s) => s.score));
  return scored.filter((s) => s.score === best).map((s) => s.r);
}

export async function geocode(
  address: string,
  fetcher: Fetcher = nominatim,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<GeocodeOutcome> {
  const tokens = addressTokens(address);
  if (tokens.length === 0) return { results: [], matchedName: null };

  const full = await fetcher(tokens.join(" "));
  if (full.length > 0 || tokens.length === 1) return { results: full, matchedName: null };

  for (let i = tokens.length - 1; i >= 0; i--) {
    await wait(REQUEST_INTERVAL_MS);
    const context = tokens.filter((_, j) => j !== i);
    const ranked = rankByContext(await fetcher(tokens[i]), context);
    if (ranked.length > 0) return { results: ranked, matchedName: tokens[i] };
  }
  return { results: [], matchedName: null };
}

async function nominatim(query: string): Promise<GeocodeResult[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    q: query,
    format: "jsonv2",
    countrycodes: "kr",
    limit: "5",
    "accept-language": "ko",
  }).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  return res.json();
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
