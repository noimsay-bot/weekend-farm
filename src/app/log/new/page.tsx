import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentFarm } from "@/lib/farm";
import { seasonLabel, todayKst, type PlanSeason } from "@/lib/season";
import { Screen } from "@/components/ui";
import { LogForm, type CropOption, type PestOption, type TargetCrop, type UnsownPlanting } from "./LogForm";

export default async function NewLogPage({ searchParams }: PageProps<"/log/new">) {
  const supabase = await createClient();
  const farm = await getCurrentFarm(supabase);
  if (!farm) redirect("/onboarding/farm");

  const sp = await searchParams;
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayKst();

  const [{ data: targets }, { data: crops }, { data: unsownRows }, { count: bedCount }] = await Promise.all([
    supabase.from("active_plan_crops").select("id, crop_id, crop_name, is_companion").eq("farm_id", farm.id).order("crop_name"),
    supabase.from("crops").select("id, name").eq("status", "confirmed").order("name"),
    // 확정 계획에 있지만 아직 심은 날짜가 없는 식재 (계획 먼저 → 파종·정식 기록)
    supabase
      .from("plantings")
      .select("id, crop_id, crops(name), field_plans!inner(farm_id, status, year, season)")
      .eq("status", "active")
      .is("sow_date", null)
      .is("transplant_date", null)
      .eq("field_plans.farm_id", farm.id)
      .eq("field_plans.status", "confirmed")
      .order("created_at"),
    supabase.from("field_beds").select("id", { count: "exact", head: true }).eq("farm_id", farm.id),
  ]);
  const unsown: UnsownPlanting[] = ((unsownRows ?? []) as unknown as {
    id: string;
    crop_id: string;
    crops: { name: string };
    field_plans: { year: number; season: PlanSeason };
  }[]).map((u) => ({ id: u.id, crop_id: u.crop_id, crop_name: u.crops.name, season_label: seasonLabel(u.field_plans) }));
  const cropIds = [...new Set((targets ?? []).map((t) => t.crop_id))];
  const { data: pests } = await supabase
    .from("crop_pest_controls")
    .select("id, crop_id, pest_name, ingredient_name, moa_code, is_organic, safe_days_before_harvest")
    .in("crop_id", cropIds.length ? cropIds : ["00000000-0000-0000-0000-000000000000"])
    .order("ingredient_name");

  return (
    <Screen title="작업 기록">
      <LogForm
        farmId={farm.id}
        initialDate={date}
        targets={(targets ?? []) as TargetCrop[]}
        pests={(pests ?? []) as PestOption[]}
        crops={(crops ?? []) as CropOption[]}
        unsown={unsown}
        hasBeds={(bedCount ?? 0) > 0}
      />
    </Screen>
  );
}
