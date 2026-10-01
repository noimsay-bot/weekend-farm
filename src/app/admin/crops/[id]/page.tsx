import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OPTIONAL_CROP_FIELDS, REQUIRED_CROP_FIELDS } from "@/lib/crop-fields";
import { Screen } from "@/components/ui";
import { QuickConfirm } from "../QuickConfirm";
import { CropActions } from "./CropActions";
import { FieldRow, type FieldSource } from "./FieldRow";

type Crop = Record<string, unknown> & { id: string; name: string; status: string; source_url: string | null };

export default async function AdminCropPage({ params }: PageProps<"/admin/crops/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_app_admin");
  if (!isAdmin) redirect("/admin/crops");

  const [{ data: crop }, { data: sources }, { data: calendars }, { data: fertilizers }, { data: pests }] =
    await Promise.all([
      supabase.from("crops").select("*, crop_families(name)").eq("id", id).maybeSingle(),
      supabase.from("crop_field_sources").select("*").eq("crop_id", id),
      supabase.from("crop_regional_calendars").select("*").eq("crop_id", id).order("cropping_type"),
      supabase.from("crop_fertilizer_schedules").select("*").eq("crop_id", id).order("stage").order("sequence"),
      supabase.from("crop_pest_controls").select("*").eq("crop_id", id).order("pest_name"),
    ]);
  if (!crop) notFound();
  const c = crop as Crop & { crop_families: { name: string } | null };

  const sourceBy = new Map(((sources ?? []) as FieldSource[]).map((s) => [s.field_name, s]));
  const missing = REQUIRED_CROP_FIELDS.filter((f) => {
    const s = sourceBy.get(f.name);
    return !(s?.approved || s?.manual_input);
  });
  const currentValue = (name: string) => (name === "family_id" ? (c.crop_families?.name ?? null) : c[name]);

  return (
    <Screen title={c.name}>
      <Link href="/admin/crops" className="text-sm text-primary">
        ← 작물 목록
      </Link>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={c.status === "confirmed" ? "font-semibold text-primary" : "text-neutral-600"}>
          {c.status === "confirmed" ? "확정됨" : `검토 중 · 남은 필드 ${missing.length}개`}
        </span>
        {c.source_url && (
          <a href={c.source_url} target="_blank" rel="noreferrer" className="text-primary underline">
            농사로 원문
          </a>
        )}
      </div>
      {c.status !== "confirmed" && c.source_url && (
        <QuickConfirm
          cropIds={[c.id]}
          label="원문 값 승인하고 바로 확정"
          confirmText={`${c.name}을(를) 확정할까요? 원문에서 뽑은 값은 승인되고, 값이 없는 필드는 빈 값으로 남아요.`}
        />
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">필수 필드</h2>
        {REQUIRED_CROP_FIELDS.map((f) => (
          <FieldRow key={f.name} cropId={c.id} def={f} value={currentValue(f.name)} source={sourceBy.get(f.name) ?? null} />
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">선택 필드</h2>
        {OPTIONAL_CROP_FIELDS.map((f) => (
          <FieldRow key={f.name} cropId={c.id} def={f} value={currentValue(f.name)} source={sourceBy.get(f.name) ?? null} />
        ))}
      </section>

      <section className="flex flex-col gap-2 text-sm">
        <h2 className="font-semibold">관행 시기</h2>
        {(calendars ?? []).length === 0 && <p className="text-neutral-500">없음</p>}
        {(calendars ?? []).map((r) => (
          <p key={r.id}>
            {r.region} {r.cropping_type} · {({ sow: "파종", transplant: "정식", harvest: "수확" } as Record<string, string>)[r.activity]}{" "}
            {r.start_month}/{r.start_day} ~ {r.end_month}/{r.end_day}
          </p>
        ))}
      </section>

      <section className="flex flex-col gap-2 text-sm">
        <h2 className="font-semibold">비료 (kg/10a 원값)</h2>
        {(fertilizers ?? []).length === 0 && <p className="text-neutral-500">없음</p>}
        {(fertilizers ?? []).map((r) => (
          <div key={r.id} className="rounded bg-white p-2">
            <p>
              {r.stage === "base" ? "밑거름" : `웃거름 ${r.sequence}회`}
              {r.days_after_planting !== null && ` (정식·파종 후 ${r.days_after_planting}일)`} · N {r.n_kg_per_10a ?? "—"} / P{" "}
              {r.p_kg_per_10a ?? "—"} / K {r.k_kg_per_10a ?? "—"} · 퇴비 {r.compost_kg_per_10a ?? "—"} · 석회 {r.lime_kg_per_10a ?? "—"}
            </p>
            {r.note && <p className="mt-1 text-xs text-neutral-500">{r.note}</p>}
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2 text-sm">
        <h2 className="font-semibold">농약 성분 ({(pests ?? []).length}건)</h2>
        {(pests ?? []).slice(0, 50).map((r) => (
          <p key={r.id}>
            {r.pest_name} · {r.ingredient_name} · 작용기작 {r.moa_code ?? <span className="text-amber-700">누락</span>}
          </p>
        ))}
      </section>

      <CropActions cropId={c.id} canConfirm={missing.length === 0 && c.status !== "confirmed"} />
    </Screen>
  );
}
