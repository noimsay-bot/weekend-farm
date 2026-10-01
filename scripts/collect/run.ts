// 작물 데이터 수집 (수동 실행): npm run collect
// 필요한 환경변수(.env.local):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (필수)
//   NONGSARO_GARDEN_KEY     농사로 OpenAPI 텃밭가꾸기 정보 (fildMnfct)
//   DATA_GO_KR_SERVICE_KEY  공공데이터포털 (비료 표준사용량 처방)
//   PSIS_API_KEY            농약안전정보시스템 (농약안전사용지침)
// 키가 없는 소스는 건너뛰고 missing_report.md에 적는다.
import { writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CROP_SEEDS, cropsForTitle } from "./crop-list";
import { extractGarden, type GardenExtraction } from "./extract";
import { fertilizerRows, pickFertilizerStandard } from "./fertilizer";
import { preventionFromText } from "./prevention";
import {
  PSIS_SOURCE_URL,
  getGardenArticle,
  listFertilizerStandards,
  listGardenArticles,
  listPesticideUses,
} from "./sources";
import { REQUIRED_CROP_FIELDS } from "../../src/lib/crop-fields";
import { buildMissingReport, type CropReport } from "./report";

const env = (k: string) => process.env[k]?.trim() || null;

async function must<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

type CropRow = { id: string; name: string };

async function seedCrops(db: SupabaseClient): Promise<Map<string, CropRow>> {
  // 이름만 넣는다. 이미 있으면 건드리지 않는다 (status 유지).
  await must(
    db.from("crops").upsert(
      CROP_SEEDS.map((c) => ({ name: c.name })),
      { onConflict: "name", ignoreDuplicates: true },
    ),
  );
  const crops = await must(db.from("crops").select("id, name"));
  const byName = new Map((crops as CropRow[]).map((c) => [c.name, c]));

  const tagNames = [...new Set(CROP_SEEDS.flatMap((c) => c.tags ?? []))];
  await must(db.from("crop_tags").upsert(tagNames.map((name) => ({ name })), { onConflict: "name", ignoreDuplicates: true }));
  const tags = (await must(db.from("crop_tags").select("id, name"))) as { id: string; name: string }[];
  const tagId = new Map(tags.map((t) => [t.name, t.id]));

  const tagMap = CROP_SEEDS.flatMap((c) =>
    (c.tags ?? []).map((t) => ({ crop_id: byName.get(c.name)!.id, tag_id: tagId.get(t)! })),
  );
  await must(db.from("crop_tag_map").upsert(tagMap, { onConflict: "crop_id,tag_id", ignoreDuplicates: true }));

  const varieties = CROP_SEEDS.flatMap((c) =>
    (c.varieties ?? []).map((name) => ({ crop_id: byName.get(c.name)!.id, farm_id: null, name, value_source: "user" })),
  );
  if (varieties.length) {
    await must(
      db.from("crop_varieties").upsert(varieties, { onConflict: "crop_id,farm_id,name", ignoreDuplicates: true }),
    );
  }
  return byName;
}

async function lockedFields(db: SupabaseClient, cropId: string): Promise<Set<string>> {
  const rows = (await must(
    db.from("crop_field_sources").select("field_name, approved, manual_input").eq("crop_id", cropId),
  )) as { field_name: string; approved: boolean; manual_input: boolean }[];
  return new Set(rows.filter((r) => r.approved || r.manual_input).map((r) => r.field_name));
}

async function saveGarden(db: SupabaseClient, crop: CropRow, ex: GardenExtraction, sourceUrl: string) {
  const locked = await lockedFields(db, crop.id);
  const update: Record<string, unknown> = { source_url: sourceUrl };
  const sources: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const f of ex.fields) {
    if (locked.has(f.field) || seen.has(f.field)) continue;
    seen.add(f.field);
    if (f.value !== null) update[f.field] = f.value;
    sources.push({
      crop_id: crop.id,
      field_name: f.field,
      extracted_value: f.value === null ? null : String(f.value),
      source_text: f.sourceText,
      source_url: sourceUrl,
      approved: false,
      manual_input: false,
    });
  }
  await must(db.from("crops").update(update).eq("id", crop.id));
  if (sources.length) await must(db.from("crop_field_sources").upsert(sources, { onConflict: "crop_id,field_name" }));

  // 원문에 같은 작형·작업 기간이 여러 번 나오면 upsert가 한 묶음 안의 중복 키로 실패한다 → 처음 것만 쓴다
  const firstCalendars = ex.calendars.filter(
    (c, i) => ex.calendars.findIndex((x) => x.croppingType === c.croppingType && x.activity === c.activity) === i,
  );
  if (firstCalendars.length) {
    await must(
      db.from("crop_regional_calendars").upsert(
        firstCalendars.map((c) => ({
          crop_id: crop.id,
          region: "전국",
          cropping_type: c.croppingType,
          activity: c.activity,
          start_month: c.startMonth,
          start_day: c.startDay,
          end_month: c.endMonth,
          end_day: c.endDay,
          source_url: sourceUrl,
        })),
        { onConflict: "crop_id,region,cropping_type,activity" },
      ),
    );
  }
}

function dilutionFactor(text: string | null): number | null {
  const m = text?.replace(/,/g, "").match(/(\d+)\s*배/);
  return m ? Number(m[1]) : null;
}

async function main() {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY가 필요합니다 (.env.local)");
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const gardenKey = env("NONGSARO_GARDEN_KEY");
  const dataKey = env("DATA_GO_KR_SERVICE_KEY");
  const psisKey = env("PSIS_API_KEY");
  const skipped: string[] = [];

  console.log("1/4 작물·품종·태그 시드");
  const crops = await seedCrops(db);
  const reports = new Map<string, CropReport>(
    CROP_SEEDS.map((c) => [c.name, { name: c.name, gardenUrl: null, fertilizer: false, pesticides: 0, missingMoa: 0, notes: [] }]),
  );
  const gardenByCrop = new Map<string, { ex: GardenExtraction; url: string }>();

  console.log("2/4 농사로 텃밭가꾸기");
  if (gardenKey) {
    const articles = await listGardenArticles(gardenKey);
    for (const a of articles) {
      const targets = cropsForTitle(a.title);
      if (targets.length === 0) continue;
      const { text, url: sourceUrl } = await getGardenArticle(gardenKey, a.cntntsNo);
      const ex = extractGarden(text);
      for (const seed of targets) {
        const crop = crops.get(seed.name)!;
        await saveGarden(db, crop, ex, sourceUrl);
        gardenByCrop.set(seed.name, { ex, url: sourceUrl });
        reports.get(seed.name)!.gardenUrl = sourceUrl;
        const prevention = preventionFromText(crop.id, text, sourceUrl);
        if (prevention.length) {
          await must(db.from("pest_prevention_schedules").delete().eq("crop_id", crop.id));
          await must(db.from("pest_prevention_schedules").insert(prevention));
        }
        console.log(`  ${seed.name} ← ${a.title} (${ex.fields.length}개 필드)`);
      }
    }
  } else {
    skipped.push("NONGSARO_GARDEN_KEY 없음: 텃밭가꾸기 원문 수집 건너뜀");
  }

  console.log("3/4 비료 표준사용량 처방");
  if (dataKey) {
    const standards = await listFertilizerStandards(dataKey);
    for (const seed of CROP_SEEDS) {
      const names = [seed.name, ...(seed.aliases ?? [])];
      const std = pickFertilizerStandard(standards, names);
      const garden = gardenByCrop.get(seed.name);
      const rows = fertilizerRows(crops.get(seed.name)!.id, std, garden?.ex.fertilizers ?? [], garden?.url ?? null);
      if (!rows.length) continue;
      await must(db.from("crop_fertilizer_schedules").delete().eq("crop_id", crops.get(seed.name)!.id));
      await must(db.from("crop_fertilizer_schedules").insert(rows));
      reports.get(seed.name)!.fertilizer = Boolean(std);
    }
  } else {
    skipped.push("DATA_GO_KR_SERVICE_KEY 없음: 비료 처방 수집 건너뜀");
  }

  console.log("4/4 농약안전사용지침");
  if (psisKey) {
    for (const seed of CROP_SEEDS) {
      const crop = crops.get(seed.name)!;
      const names = [seed.name, ...(seed.aliases ?? [])];
      const uses = (await Promise.all(names.map((n) => listPesticideUses(psisKey, n)))).flat();
      const unique = new Map(uses.map((u) => [`${u.pestName}|${u.ingredient}`, u]));
      if (unique.size === 0) continue;
      await must(db.from("crop_pest_controls").delete().eq("crop_id", crop.id));
      await must(
        db.from("crop_pest_controls").insert(
          [...unique.values()].map((u) => ({
            crop_id: crop.id,
            pest_name: u.pestName,
            ingredient_name: u.ingredient,
            moa_code: u.moaCode,
            formulation: u.formulation,
            dilution_factor: dilutionFactor(u.dilution),
            safe_days_before_harvest: u.safeDays,
            max_applications: u.maxUses,
            is_organic: false,
            source_url: PSIS_SOURCE_URL,
          })),
        ),
      );
      const r = reports.get(seed.name)!;
      r.pesticides = unique.size;
      r.missingMoa = [...unique.values()].filter((u) => !u.moaCode).length;
    }
  } else {
    skipped.push("PSIS_API_KEY 없음: 농약안전사용지침 수집 건너뜀");
  }

  // 농작물재해예방정보(frcDsstrPrevnt)는 본문 없이 호별 .hwp 첨부만 제공해 대응 문구를 자동으로 뽑을 수 없다.
  // 특보 알림은 대응 문구 없이 나가며, 문구는 weather_response_guides에 관리자가 직접 넣는다.
  skipped.push("농작물재해예방정보: API가 .hwp 첨부파일만 제공해 기상특보 대응 문구는 수집하지 않음 (관리자 입력)");

  // 누락 리포트: DB의 현재 상태 기준
  const sourceRows = (await must(
    db.from("crop_field_sources").select("crop_id, field_name, extracted_value, approved, manual_input"),
  )) as { crop_id: string; field_name: string; extracted_value: string | null; approved: boolean; manual_input: boolean }[];
  const cropById = new Map([...crops.values()].map((c) => [c.id, c.name]));
  for (const s of sourceRows) {
    const name = cropById.get(s.crop_id);
    if (!name) continue;
    reports.get(name)!.notes.push(s);
  }
  const report = buildMissingReport([...reports.values()], REQUIRED_CROP_FIELDS, skipped);
  writeFileSync("missing_report.md", report);
  console.log("missing_report.md 생성");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
