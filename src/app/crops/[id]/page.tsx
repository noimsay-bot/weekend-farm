import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentFarm } from "@/lib/farm";
import { baseLines, productFor, topDressingLines, type FertilizerRow, type ProductRow } from "@/lib/fertilizer-text";
import { formatKDate } from "@/lib/dates";
import { todayKst } from "@/lib/season";
import { rangesFor, type TimingCalendar } from "@/lib/weather/timing";
import { nextOccurrence, seedlingStart } from "@/lib/weather/recommend";
import { formatFieldValue, REQUIRED_CROP_FIELDS } from "@/lib/crop-fields";
import { Screen } from "@/components/ui";
import { GuideBody } from "@/components/GuideBody";
import { YearBar, type YearRange } from "@/components/YearBar";
import { PesticideList, type PestRow } from "./PesticideList";

const ACTIVITY: Record<string, string> = { sow: "파종", transplant: "정식", harvest: "수확" };

export default async function CropDetailPage({ params }: PageProps<"/crops/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const farm = await getCurrentFarm(supabase);
  const { data: crop } = await supabase.from("crops").select("*, crop_families(name)").eq("id", id).eq("status", "confirmed").maybeSingle();
  if (!crop) notFound();

  const [calendars, fertilizers, pests, companions, products, productSettings, guides, refs] = await Promise.all([
    supabase.from("crop_regional_calendars").select("*").eq("crop_id", id),
    supabase.from("crop_fertilizer_schedules").select("*").eq("crop_id", id).order("stage").order("sequence"),
    supabase.from("crop_pest_controls").select("*").eq("crop_id", id).order("pest_name"),
    supabase
      .from("crop_companions")
      .select("relation, reason, source_url, a:crops!crop_companions_crop_a_id_fkey(id, name), b:crops!crop_companions_crop_b_id_fkey(id, name)")
      .or(`crop_a_id.eq.${id},crop_b_id.eq.${id}`),
    supabase.from("fertilizer_products").select("id, farm_id, name, n_pct, p_pct, k_pct, is_default"),
    farm ? supabase.from("farm_fertilizer_settings").select("usage, product_id").eq("farm_id", farm.id) : Promise.resolve({ data: [] }),
    supabase.from("crop_guides").select("section, body").eq("crop_id", id).order("sort"),
    supabase.from("crop_references").select("ref_key, kind, title, url, publisher, summary").eq("crop_id", id).order("sort"),
  ]);
  const references = (refs.data ?? []) as { ref_key: string; kind: "doc" | "video"; title: string; url: string; publisher: string | null; summary: string | null }[];
  const videos = references.filter((r) => r.kind === "video" && youtubeId(r.url));
  const docs = references.filter((r) => !videos.includes(r));

  const today = todayKst();
  const region = farm ? ((await supabase.from("farms").select("region").eq("id", farm.id).single()).data?.region ?? null) : null;
  const cal = (calendars.data ?? []) as TimingCalendar[];
  const transplant = rangesFor(cal, id, "transplant", region);
  const seedStart = seedlingStart(transplant, crop.seedling_days, today);
  const prods = (products.data ?? []) as ProductRow[];
  const baseProduct = productFor("base", prods, productSettings.data ?? []);
  const topProduct = productFor("top_dressing", prods, productSettings.data ?? []);
  const others = ((companions.data ?? []) as unknown as {
    relation: "good" | "bad";
    reason: string | null;
    source_url: string | null;
    a: { id: string; name: string };
    b: { id: string; name: string };
  }[]).map((c) => ({ ...c, other: c.a.id === id ? c.b : c.a }));

  const summaryFields = ["sow_method", "season", "plant_spacing_cm", "row_spacing_cm", "plants_per_pyeong", "days_to_harvest", "harvest_window_days", "watering_interval_days", "heat_tolerance", "rotation_risk", "rest_seasons"];

  return (
    <Screen title={crop.name}>
      <Link href="/crops" className="text-sm text-primary">
        ← 작물 백과
      </Link>
      {crop.category && <p className="-mt-3 text-sm text-neutral-500">{crop.category}</p>}
      {crop.description && <p className="text-sm text-neutral-700">{crop.description}</p>}

      {cal.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">한눈에 보기</h2>
          <YearBar ranges={cal as unknown as YearRange[]} region={region} />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">재배 요약</h2>
        <dl className="grid grid-cols-2 gap-2 rounded-lg bg-white p-3 text-sm">
          <dt className="text-neutral-500">과</dt>
          <dd>{(crop.crop_families as { name: string } | null)?.name ?? "—"}</dd>
          {summaryFields.map((name) => {
            const def = REQUIRED_CROP_FIELDS.find((f) => f.name === name)!;
            return [
              <dt key={`${name}-l`} className="text-neutral-500">
                {def.label}
              </dt>,
              <dd key={`${name}-v`}>{formatFieldValue(def, crop[name])}</dd>,
            ];
          })}
        </dl>
        {cal.length > 0 && (
          <ul className="rounded-lg bg-white p-3 text-sm">
            {cal.map((c) => (
              <li key={`${c.region}-${c.cropping_type}-${c.activity}`}>
                {c.region} {c.cropping_type} {ACTIVITY[c.activity]}: {c.start_month}/{c.start_day} ~ {c.end_month}/{c.end_day}
              </li>
            ))}
          </ul>
        )}
      </section>

      {(guides.data ?? []).map((g) => (
        <section key={g.section} className="flex flex-col gap-2">
          <h2 className="font-semibold">{g.section}</h2>
          <div className="rounded-lg bg-white p-3 text-sm leading-relaxed">
            <GuideBody body={g.body} />
          </div>
        </section>
      ))}

      {(crop.seedling_days || transplant.length > 0) && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">육묘 안내</h2>
          <div className="rounded-lg bg-white p-3 text-sm">
            {crop.seedling_days && <p>육묘일수 약 {crop.seedling_days}일</p>}
            {transplant.length > 0 && (
              <p>
                관행 정식 시기 {formatKDate(nextOccurrence(transplant[0], today).start)} ~ {formatKDate(nextOccurrence(transplant[0], today).end)}
              </p>
            )}
            {seedStart && <p className="font-medium text-primary">모종을 직접 키운다면 {formatKDate(seedStart)}쯤 씨를 뿌리세요.</p>}
            <p className="text-xs text-neutral-500">육묘 과정은 기록하지 않고 시기만 안내해요.</p>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">시기별 비료</h2>
        {(fertilizers.data ?? []).length === 0 && <p className="text-sm text-neutral-500">비료 자료가 없어요.</p>}
        {((fertilizers.data ?? []) as (FertilizerRow & { id: string; sequence: number; days_after_planting: number | null; note: string | null })[]).map((f) => (
          <div key={f.id} className="rounded-lg bg-white p-3 text-sm">
            <p className="font-medium">
              {f.stage === "base" ? "밑거름 (밭만들기)" : `웃거름 ${f.sequence}회${f.days_after_planting !== null ? ` · 심은 후 ${f.days_after_planting}일` : ""}`}
            </p>
            {(f.stage === "base" ? baseLines(f, baseProduct, null) : topDressingLines(f, topProduct, null, null)).map((l) => (
              <p key={l}>{l}</p>
            ))}
            {f.stage === "top_dressing" && <p className="text-xs text-neutral-500">심은 뒤에는 포기 수에 맞춰 포기당 양으로 알려드려요.</p>}
          </div>
        ))}
        <Link href="/settings/fertilizer" className="text-xs text-primary underline">
          사용하는 비료 제품 바꾸기
        </Link>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">병해충별 농약</h2>
        <p className="rounded bg-amber-50 p-2 text-sm font-medium text-amber-900">사용 전 제품 라벨의 등록 작물과 사용법을 확인하세요</p>
        <PesticideList rows={(pests.data ?? []) as PestRow[]} />
      </section>

      {crop.pruning_required && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">가지치기</h2>
          <div className="rounded-lg bg-white p-3 text-sm">
            {crop.pruning_method && <p>{crop.pruning_method}</p>}
            {crop.pruning_timing && <p className="text-neutral-600">시기: {crop.pruning_timing}</p>}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">같이 심으면</h2>
        {others.length === 0 && <p className="text-sm text-neutral-500">궁합 정보가 없어요.</p>}
        {(["good", "bad"] as const).map((rel) =>
          others.filter((o) => o.relation === rel).length ? (
            <div key={rel} className="rounded-lg bg-white p-3 text-sm">
              <p className="font-medium">{rel === "good" ? "좋은 작물" : "나쁜 작물"}</p>
              {others
                .filter((o) => o.relation === rel)
                .map((o) => (
                  <p key={o.other.id}>
                    {o.other.name}
                    {o.reason && <span className="text-neutral-500"> — {o.reason}</span>}
                  </p>
                ))}
            </div>
          ) : null,
        )}
      </section>

      {videos.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">추천 영상</h2>
          {videos.map((v) => (
            <div key={v.ref_key} className="flex flex-col gap-2 rounded-lg bg-white p-3 text-sm">
              <iframe
                className="aspect-video w-full rounded"
                src={`https://www.youtube-nocookie.com/embed/${youtubeId(v.url)}`}
                title={v.title}
                loading="lazy"
                allowFullScreen
              />
              <p className="font-medium">{v.title}</p>
              {v.publisher && <p className="text-xs text-neutral-500">{v.publisher}</p>}
              {v.summary && <p className="text-neutral-700">{v.summary}</p>}
            </div>
          ))}
        </section>
      )}

      {docs.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">참고 자료</h2>
          <p className="text-xs text-neutral-500">여러 공공기관 자료와 영상을 바탕으로 정리했어요. 핵심 수치는 두 곳 이상에서 확인한 값이에요.</p>
          <ul className="flex flex-col gap-1 rounded-lg bg-white p-3 text-sm">
            {docs.map((r) => (
              <li key={r.ref_key}>
                <a href={r.url} target="_blank" rel="noreferrer" className="text-primary underline">
                  {r.title}
                </a>
                {r.publisher && <span className="text-neutral-500"> · {r.publisher}</span>}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        crop.source_url && (
          <a href={crop.source_url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
            출처: 농사로
          </a>
        )
      )}
    </Screen>
  );
}

function youtubeId(url: string): string | null {
  return url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/)?.[1] ?? null;
}
