import "server-only";
import { XMLParser } from "fast-xml-parser";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/dates";
import { extractWeeklySummaries } from "@/lib/dashboard/weekly";
import { hwpxText } from "@/lib/hwpx";

const NONGSARO = "http://api.nongsaro.go.kr/service/weekFarmInfo";
const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });

function items(xml: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      if (k === "item") (Array.isArray(v) ? v : [v]).forEach((i) => i && typeof i === "object" && out.push(i as Record<string, string>));
      else walk(v);
    }
  };
  walk(parser.parse(xml));
  return out;
}

async function get(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

// 농촌진흥청 주간농사정보: 주 1회 최신 호를 받아 요약의 작물별 문장을 저장한다.
// API는 본문 없이 첨부파일(hwpx·hwp·pdf)만 주므로 hwpx를 받아 읽는다.
export async function collectWeeklyFarmInfo(db: SupabaseClient, apiKey: string, today: string) {
  const weekStart = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const { count } = await db.from("weekly_farm_info").select("id", { count: "exact", head: true }).eq("week_start", weekStart);
  if ((count ?? 0) > 0) return { skipped: true };

  const list = items(await (await get(`${NONGSARO}/weekFarmInfoList?apiKey=${apiKey}&pageNo=1&numOfRows=1`)).text());
  const latest = list[0];
  if (!latest?.cntntsNo) return { found: 0 };
  const names = String(latest.fileName ?? "").split("|");
  const urls = String(latest.downUrlList ?? latest.downUrl ?? "").split("|");
  const hwpxUrl = urls[names.findIndex((n) => n.toLowerCase().endsWith(".hwpx"))];
  if (!hwpxUrl) return { found: 0, reason: "hwpx 첨부 없음" };

  const text = hwpxText(Buffer.from(await (await get(hwpxUrl)).arrayBuffer()));
  const { data: crops } = await db.from("crops").select("id, name").eq("status", "confirmed");
  const notes = extractWeeklySummaries(text, (crops ?? []) as { id: string; name: string }[]);
  const sourceUrl = `https://www.nongsaro.go.kr/portal/ps/psb/psbl/workScheduleDtl.ps?cntntsNo=${latest.cntntsNo}`;
  if (notes.length) {
    await db.from("weekly_farm_info").insert(
      notes.map((n) => ({ week_start: weekStart, crop_name: n.cropName, crop_id: n.cropId, pest_name: n.pest, summary: n.summary, source_url: sourceUrl })),
    );
  }
  return { issue: latest.subject, found: notes.length };
}
