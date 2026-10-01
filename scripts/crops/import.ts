// 작물 백과사전 자료를 DB에 넣는다: npm run crops:import -- 배추 [무 …]  (인자 없으면 data/crops 전체)
// 이름이 없으면 작물을 새로 만들고(draft), 있으면 갱신한다. 관리자가 직접 입력한 필드는 덮어쓰지 않는다.
// 확정 여부는 그대로 두므로, 새 작물은 /admin/crops에서 승인해야 앱에 나타난다.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { FIELD_DEFS, validateCropDoc, type CropDoc } from "./schema";

const DIR = join(__dirname, "..", "..", "data", "crops");

async function must<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

const day = (s: string) => s.split("-").map(Number) as [number, number];

async function importCrop(db: SupabaseClient, doc: CropDoc) {
  const refUrl = (keys: string[]) => doc.refs.find((r) => r.key === keys[0])?.url ?? null;
  const firstDoc = doc.refs.find((r) => r.kind === "doc")?.url ?? doc.refs[0]?.url ?? null;

  let crop = (await must(db.from("crops").select("id, status").eq("name", doc.name).maybeSingle())) as { id: string; status: string } | null;
  if (!crop) crop = (await must(db.from("crops").insert({ name: doc.name }).select("id, status").single())) as { id: string; status: string };
  const cropId = crop.id;

  const manual = new Set(
    ((await must(db.from("crop_field_sources").select("field_name").eq("crop_id", cropId).eq("manual_input", true))) as { field_name: string }[]).map(
      (r) => r.field_name,
    ),
  );

  // crops 칸
  const update: Record<string, unknown> = { description: doc.summary, category: doc.category, source_url: firstDoc };
  if (!manual.has("family_id")) {
    let familyId: string | null = null;
    if (typeof doc.family.value === "string") {
      await must(db.from("crop_families").upsert({ name: doc.family.value }, { onConflict: "name", ignoreDuplicates: true }));
      familyId = ((await must(db.from("crop_families").select("id").eq("name", doc.family.value).single())) as { id: string }).id;
    }
    update.family_id = familyId;
  }
  for (const [name, f] of Object.entries(doc.fields)) if (!manual.has(name)) update[name] = f.value;
  await must(db.from("crops").update(update).eq("id", cropId));

  // 필드별 근거 (직접 입력한 필드는 그대로)
  await must(db.from("crop_field_sources").delete().eq("crop_id", cropId).eq("manual_input", false));
  const sources = [["family_id", doc.family] as const, ...Object.entries(doc.fields)]
    .filter(([name]) => !manual.has(name))
    .map(([name, f]) => ({
      crop_id: cropId,
      field_name: name,
      extracted_value: f.value === null ? null : String(f.value),
      source_text: f.evidence,
      source_url: refUrl(f.refs),
      origin: "ai_research",
      confidence: f.confidence,
      ref_keys: f.refs,
      approved: false,
      manual_input: false,
    }));
  if (sources.length) await must(db.from("crop_field_sources").insert(sources));

  // 관행 시기
  await must(db.from("crop_regional_calendars").delete().eq("crop_id", cropId));
  if (doc.calendars.length) {
    await must(
      db.from("crop_regional_calendars").insert(
        doc.calendars.map((c) => {
          const [sm, sd] = day(c.start);
          const [em, ed] = day(c.end);
          return {
            crop_id: cropId,
            region: c.region,
            cropping_type: c.cropping_type,
            activity: c.activity,
            start_month: sm,
            start_day: sd,
            end_month: em,
            end_day: ed,
            source_url: refUrl(c.refs),
          };
        }),
      ),
    );
  }

  // 비료: 성분량(N·P·K)은 공공데이터 처방값을 유지하고, 퇴비·석회·웃거름 시기만 자료로 채운다
  if (doc.fertilizer) {
    type Row = { stage: string; sequence: number; n_kg_per_10a: number | null; p_kg_per_10a: number | null; k_kg_per_10a: number | null; note: string | null; source_url: string | null };
    const existing = (await must(db.from("crop_fertilizer_schedules").select("stage, sequence, n_kg_per_10a, p_kg_per_10a, k_kg_per_10a, note, source_url").eq("crop_id", cropId))) as Row[];
    const base = existing.find((r) => r.stage === "base");
    const tops = existing.filter((r) => r.stage === "top_dressing");
    const total = (k: "n_kg_per_10a" | "p_kg_per_10a" | "k_kg_per_10a") =>
      tops.some((t) => t[k] !== null) ? tops.reduce((a, t) => a + Number(t[k] ?? 0), 0) : null;
    const post = { n: total("n_kg_per_10a"), p: total("p_kg_per_10a"), k: total("k_kg_per_10a") };
    const official = base?.note?.includes("비료 표준사용량 처방") ? base.note.split(" / ")[0] : null;

    await must(db.from("crop_fertilizer_schedules").delete().eq("crop_id", cropId));
    const rows: Record<string, unknown>[] = [];
    if (doc.fertilizer.base || base) {
      const b = doc.fertilizer.base;
      rows.push({
        crop_id: cropId,
        stage: "base",
        sequence: 1,
        n_kg_per_10a: base?.n_kg_per_10a ?? null,
        p_kg_per_10a: base?.p_kg_per_10a ?? null,
        k_kg_per_10a: base?.k_kg_per_10a ?? null,
        compost_kg_per_10a: b?.compost_kg_per_10a ?? null,
        lime_kg_per_10a: b?.lime_kg_per_10a ?? null,
        note: [official, b?.note].filter(Boolean).join(" / ") || null,
        source_url: official ? base!.source_url : b ? refUrl(b.refs) : null,
      });
    }
    const steps = doc.fertilizer.top_dressing ?? [];
    const share = (v: number | null) => (v === null || steps.length === 0 ? null : Math.round((v / steps.length) * 100) / 100);
    steps.forEach((t, i) =>
      rows.push({
        crop_id: cropId,
        stage: "top_dressing",
        sequence: i + 1,
        days_after_planting: t.days_after_planting,
        n_kg_per_10a: share(post.n),
        p_kg_per_10a: share(post.p),
        k_kg_per_10a: share(post.k),
        note: [post.n !== null && "성분량: 비료 표준사용량 처방 웃거름 균등 분배", t.note].filter(Boolean).join(" / "),
        source_url: refUrl(t.refs),
      }),
    );
    if (rows.length) await must(db.from("crop_fertilizer_schedules").insert(rows));
  }

  // 참고자료·본문
  await must(db.from("crop_references").delete().eq("crop_id", cropId));
  await must(
    db.from("crop_references").insert(
      doc.refs.map((r, i) => ({ crop_id: cropId, ref_key: r.key, kind: r.kind, title: r.title, url: r.url, publisher: r.publisher ?? null, summary: r.summary ?? null, sort: i })),
    ),
  );
  await must(db.from("crop_guides").delete().eq("crop_id", cropId));
  if (doc.guides.length) {
    await must(
      db.from("crop_guides").insert(doc.guides.map((g, i) => ({ crop_id: cropId, section: g.section, summary: g.summary, body: g.body, ref_keys: g.refs, sort: i }))),
    );
  }
  // 파종·정식 기온 기준
  await must(db.from("crop_temp_windows").delete().eq("crop_id", cropId));
  if (doc.temp_windows?.length) {
    await must(
      db.from("crop_temp_windows").insert(
        doc.temp_windows.map((w, i) => ({
          crop_id: cropId,
          cropping_type: w.cropping_type,
          activity: w.activity,
          trend: w.trend,
          from_c: w.from_c,
          to_c: w.to_c,
          basis: w.basis,
          note: w.note,
          source_url: refUrl(w.refs),
          sort: i,
        })),
      ),
    );
  }
  return { status: crop.status, manual: [...manual] };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY가 필요합니다 (.env.local)");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const names = process.argv.slice(2);
  const files = names.length ? names.map((n) => `${n}.json`) : readdirSync(DIR).filter((f) => f.endsWith(".json"));
  let failed = false;
  for (const file of files) {
    const doc = JSON.parse(readFileSync(join(DIR, file), "utf8")) as CropDoc;
    const errors = validateCropDoc(doc);
    if (errors.length) {
      failed = true;
      console.error(`✗ ${file}\n  ${errors.join("\n  ")}`);
      continue;
    }
    const r = await importCrop(db, doc);
    const unknown = Object.entries(doc.fields).filter(([, f]) => f.value === null).map(([n]) => FIELD_DEFS.get(n)?.label ?? n);
    console.log(`✓ ${doc.name} (${r.status === "confirmed" ? "승인됨 — 값만 갱신" : "검토 중"})${unknown.length ? ` · 모름: ${unknown.join(", ")}` : ""}${r.manual.length ? ` · 직접 입력 유지: ${r.manual.join(", ")}` : ""}`);
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
