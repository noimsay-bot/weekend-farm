import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { seasonLabel, type PlanSeason } from "@/lib/season";
import { Screen } from "@/components/ui";
import { PlanEditor, type EditorData } from "./PlanEditor";
import { inMonthDayRange } from "@/lib/dates";

const SEASON_ORDER: Record<string, number> = { spring: 0, autumn: 1, overwinter: 2 };

// 여름 작기(봄 계획, 4~8월) 폭염기 추천: 고온 내성 높음 + 6~8월 관행 파종 기간 + 연작 경고 없음 (M10)
async function heatPicks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  farmId: string,
  year: number,
  region: string | null,
): Promise<string[]> {
  const [{ data: strong }, { data: plans }] = await Promise.all([
    supabase
      .from("crops")
      .select("id, family_id, rotation_risk, rest_seasons, crop_regional_calendars(region, activity, start_month, start_day, end_month, end_day)")
      .eq("heat_tolerance", "high")
      .eq("status", "confirmed"),
    supabase.from("field_plans").select("year, season, field_plan_cells(crops(family_id))").eq("farm_id", farmId).eq("status", "confirmed"),
  ]);
  const history = ((plans ?? []) as unknown as { year: number; season: string; field_plan_cells: { crops: { family_id: string | null } }[] }[])
    .filter((p) => p.year * 3 + SEASON_ORDER[p.season] < year * 3)
    .sort((a, b) => b.year * 3 + SEASON_ORDER[b.season] - (a.year * 3 + SEASON_ORDER[a.season]))
    .map((p) => new Set(p.field_plan_cells.map((c) => c.crops.family_id).filter(Boolean)));
  const summer = ["06-01", "06-15", "07-01", "07-15", "08-01", "08-15"].map((d) => `${year}-${d}`);
  return ((strong ?? []) as unknown as {
    id: string;
    family_id: string | null;
    rotation_risk: string | null;
    rest_seasons: number | null;
    crop_regional_calendars: { region: string; activity: string; start_month: number; start_day: number; end_month: number; end_day: number }[];
  }[])
    .filter((c) => {
      const sow = c.crop_regional_calendars.filter((w) => w.activity !== "harvest");
      const regional = sow.filter((w) => w.region === region);
      const windows = regional.length ? regional : sow.filter((w) => w.region === "전국");
      if (!windows.some((w) => summer.some((d) => inMonthDayRange(d, w)))) return false;
      if (c.rotation_risk === "high" && c.family_id) {
        return !history.slice(0, Math.max(1, c.rest_seasons ?? 1)).some((f) => f.has(c.family_id));
      }
      return true;
    })
    .map((c) => c.id);
}

export default async function PlanPage({ params }: PageProps<"/plan/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: plan } = await supabase
    .from("field_plans")
    .select("id, farm_id, year, season, status, farms(name, width_m, height_m, onboarding_has_planted, region)")
    .eq("id", id)
    .maybeSingle();
  if (!plan) notFound();

  const [claims, settings, cells, crops, tags, companions, families, members, approvals, warnings, plantings] =
    await Promise.all([
      supabase.auth.getClaims(),
      supabase.from("farm_settings").select("cell_size_m").eq("farm_id", plan.farm_id).single(),
      supabase.from("field_plan_cells").select("id, x, y, crop_id, companion_crop_id, carry_state, rotation_flag").eq("plan_id", id),
      supabase.from("crops").select("id, name, family_id, plants_per_pyeong, heat_tolerance, crop_tag_map(tag_id)").order("name"),
      supabase.from("crop_tags").select("id, name").order("name"),
      supabase.from("crop_companions").select("crop_a_id, crop_b_id, relation, reason, source_text, source_url"),
      supabase
        .from("crop_families")
        .select("id, name, soil_diseases, soil_treatment_ingredients, lime_ph_guide, drainage_guide, source_url"),
      supabase.from("farm_members").select("user_id").eq("farm_id", plan.farm_id),
      supabase.from("field_plan_approvals").select("user_id").eq("plan_id", id),
      supabase.rpc("plan_rotation_warnings", { p_plan_id: id }),
      supabase
        .from("plantings")
        .select("id, plan_crop_id, crop_id, status, planned_plant_count, planting_cells(cell_id)")
        .eq("plan_id", id)
        .order("created_at"),
    ]);

  const farm = plan.farms as unknown as {
    name: string;
    width_m: number | null;
    height_m: number | null;
    onboarding_has_planted: boolean | null;
    region: string | null;
  };
  const picks = plan.season === "spring" && plan.status !== "confirmed" ? await heatPicks(supabase, plan.farm_id, plan.year, farm.region) : [];

  const data: EditorData = {
    plan: { id: plan.id, farmId: plan.farm_id, year: plan.year, season: plan.season as PlanSeason, status: plan.status },
    userId: claims.data?.claims.sub ?? "",
    widthM: Number(farm.width_m ?? 0),
    heightM: Number(farm.height_m ?? 0),
    cellSizeM: Number(settings.data?.cell_size_m ?? 0.5),
    hasPlanted: Boolean(farm.onboarding_has_planted),
    cells: cells.data ?? [],
    crops: (crops.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      family_id: c.family_id,
      plants_per_pyeong: c.plants_per_pyeong === null ? null : Number(c.plants_per_pyeong),
      heat_tolerance: c.heat_tolerance,
      tagIds: (c.crop_tag_map ?? []).map((t: { tag_id: string }) => t.tag_id),
    })),
    tags: tags.data ?? [],
    companions: companions.data ?? [],
    families: families.data ?? [],
    memberIds: (members.data ?? []).map((m) => m.user_id),
    approvedIds: (approvals.data ?? []).map((a) => a.user_id),
    warnings: warnings.data ?? [],
    heatPicks: picks,
    plantings: (plantings.data ?? []).map((p) => ({
      id: p.id,
      plan_crop_id: p.plan_crop_id,
      crop_id: p.crop_id,
      status: p.status,
      planned_plant_count: p.planned_plant_count,
      cellIds: (p.planting_cells ?? []).map((c: { cell_id: string }) => c.cell_id),
    })),
  };

  return (
    <Screen title={`${seasonLabel({ year: plan.year, season: plan.season as PlanSeason })} 계획`}>
      <Link href="/plan" className="text-sm text-primary">
        ← 계획 목록
      </Link>
      {data.widthM > 0 && data.heightM > 0 ? (
        <PlanEditor data={data} />
      ) : (
        <p className="text-sm">밭 크기가 없어요. 온보딩에서 가로·세로를 입력하세요.</p>
      )}
    </Screen>
  );
}
