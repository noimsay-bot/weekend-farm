import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { seasonLabel, type PlanSeason } from "@/lib/season";
import type { SeasonSummary } from "@/lib/summary/build";
import { Screen } from "@/components/ui";
import { SummaryView, type SummaryRow } from "./SummaryView";

export default async function SummaryPage({ params }: PageProps<"/plan/[id]/summary">) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: plan } = await supabase.from("field_plans").select("id, year, season, status").eq("id", id).maybeSingle();
  if (!plan) notFound();

  const [{ data: summaries }, { data: active }, { data: photos }] = await Promise.all([
    supabase.from("season_summaries").select("id, plan_crop_id, summary, representative_photo_id, created_at").eq("plan_id", id),
    supabase.from("plantings").select("id").eq("plan_id", id).eq("status", "active").limit(1),
    supabase
      .from("work_log_targets")
      .select("plan_crop_id, plan_crops!inner(plan_id), work_logs(work_date, work_log_photos(id, storage_path))")
      .eq("plan_crops.plan_id", id),
  ]);

  const photosByCrop: Record<string, { id: string; storage_path: string; date: string }[]> = {};
  for (const t of (photos ?? []) as unknown as { plan_crop_id: string; work_logs: { work_date: string; work_log_photos: { id: string; storage_path: string }[] } | null }[]) {
    for (const p of t.work_logs?.work_log_photos ?? []) (photosByCrop[t.plan_crop_id] ??= []).push({ ...p, date: t.work_logs!.work_date });
  }

  return (
    <Screen title={`${seasonLabel({ year: plan.year, season: plan.season as PlanSeason })} 결산`}>
      <Link href={`/plan/${id}`} className="text-sm text-primary">
        ← 계획으로
      </Link>
      <SummaryView
        planId={id}
        confirmed={plan.status === "confirmed"}
        allEnded={(active ?? []).length === 0}
        rows={((summaries ?? []) as { id: string; plan_crop_id: string; summary: SeasonSummary; representative_photo_id: string | null; created_at: string }[]).map(
          (s): SummaryRow => ({ ...s, photos: photosByCrop[s.plan_crop_id] ?? [] }),
        )}
      />
    </Screen>
  );
}
