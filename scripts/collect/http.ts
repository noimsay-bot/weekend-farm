// 공공 API 호출: 요청 간 지연(트래픽 한도 준수)과 재시도.
import { XMLParser } from "fast-xml-parser";

const MIN_INTERVAL_MS = Number(process.env.COLLECT_INTERVAL_MS ?? 700);
const MAX_RETRIES = 3;

let last = 0;

async function throttle() {
  const wait = last + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
}

export async function getText(url: string): Promise<string> {
  let error: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, { headers: { "User-Agent": "weekend-farm-collector/1.0" } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url.replace(/(apiKey|serviceKey)=[^&]+/, "$1=***")}`);
      const text = await res.text();
      // 공공데이터포털 게이트웨이 오류는 HTTP 200으로 온다. 빈 결과로 오인하지 않도록 구분한다.
      const gateway = text.match(/<returnReasonCode>(\d+)<\/returnReasonCode>/);
      if (gateway) {
        const msg = `공공데이터포털 오류 ${gateway[1]}: ${text.match(/<returnAuthMsg>([^<]*)/)?.[1] ?? ""}`;
        // 22: 일일 트래픽 초과, 23: 초당 요청 초과 → 23만 재시도
        if (gateway[1] === "23") throw new Error(msg);
        throw Object.assign(new Error(msg), { fatal: true });
      }
      return text;
    } catch (e) {
      if ((e as { fatal?: boolean }).fatal) throw e;
      error = e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw error;
}

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });

export function parseXml(xml: string): unknown {
  return parser.parse(xml);
}

// XML 응답에서 item 배열을 꺼낸다 (response.body.items.item 형태 등).
export function xmlItems(doc: unknown): Record<string, string>[] {
  const found: Record<string, string>[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "item") {
        const arr = Array.isArray(value) ? value : [value];
        for (const v of arr) if (v && typeof v === "object") found.push(v as Record<string, string>);
      } else {
        walk(value);
      }
    }
  };
  walk(doc);
  return found;
}

export function xmlHeader(doc: unknown): { code: string; msg: string } | null {
  const header = (doc as { response?: { header?: { resultCode?: string; resultMsg?: string } } })?.response?.header;
  return header ? { code: String(header.resultCode ?? ""), msg: String(header.resultMsg ?? "") } : null;
}
