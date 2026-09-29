import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentFarm } from "@/lib/farm";
import { nextSeason, seasonOf, todayKst, type PlanSeason } from "@/lib/season";
import { Screen } from "@/components/ui";
import { NewPlanForm, type CarryCandidate } from "./NewPlanForm";

export default async function NewPlanPage({ searchParams }: PageProps<"/plan/new">) {
  const supabase = await createClient();
  const farm = await getCurrentFarm(supabase);
  if (!farm) redirect("/onboarding/farm");

  const sp = await searchParams;
  const fallback = nextSeason(seasonOf(todayKst()));
  const year = Number(sp.year) || fallback.year;
  const season = (["spring", "autumn", "overwinter"].includes(String(sp.season)) ? sp.season : fallback.season) as PlanSeason;

  const [{ data: plans }, { data: candidates }] = await Promise.all([
    supabase.from("field_plans").select("id, year, season, status").eq("farm_id", farm.id),
    supabase.rpc("carry_over_candidates", { p_farm_id: farm.id, p_year: year }),
  ]);

  return (
    <Screen title="새 계획">
      <Link href="/plan" className="text-sm text-primary">
        ← 계획 목록
      </Link>
      <NewPlanForm
        farmId={farm.id}
        initialYear={year}
        initialSeason={season}
        plans={(plans ?? []) as { id: string; year: number; season: PlanSeason; status: string }[]}
        candidates={(candidates ?? []) as CarryCandidate[]}
      />
    </Screen>
  );
}
