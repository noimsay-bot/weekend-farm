import "server-only";
import { XMLParser } from "fast-xml-parser";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/dates";
import { extractCropPestNotes, htmlToPlain } from "@/lib/dashboard/weekly";

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
  return res.text();
}

// 농촌진흥청 주간농사정보: 주 1회 최신 호를 받아 작물별 병해충 문장을 저장한다.
export async function collectWeeklyFarmInfo(db: SupabaseClient, apiKey: string, today: string) {
  const weekStart = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const { count } = await db.from("weekly_farm_info").select("id", { count: "exact", head: true }).eq("week_start", weekStart);
  if ((count ?? 0) > 0) return { skipped: true };

  const list = items(await get(`${NONGSARO}/weekFarmInfoList?apiKey=${apiKey}&pageNo=1&numOfRows=1`));
  const latest = list[0];
  if (!latest?.cntntsNo) return { found: 0 };
  const detail = items(await get(`${NONGSARO}/weekFarmInfoDtl?apiKey=${apiKey}&cntntsNo=${latest.cntntsNo}`))[0] ?? {};
  const body = Object.values(detail).map(String).sort((a, b) => b.length - a.length)[0] ?? "";
  const text = htmlToPlain(body);

  const { data: crops } = await db.from("crops").select("id, name").eq("status", "confirmed");
  const notes = extractCropPestNotes(text, (crops ?? []) as { id: string; name: string }[]);
  const sourceUrl = `https://www.nongsaro.go.kr/portal/ps/psb/psbl/workScheduleDtl.ps?cntntsNo=${latest.cntntsNo}`;
  if (notes.length) {
    await db.from("weekly_farm_info").insert(
      notes.map((n) => ({ week_start: weekStart, crop_name: n.cropName, crop_id: n.cropId, pest_name: n.pest, summary: n.summary, source_url: sourceUrl })),
    );
  }
  return { found: notes.length };
}
