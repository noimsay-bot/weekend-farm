import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { diffDays, formatKDate } from "@/lib/dates";
import { SEASON_LABEL, todayKst, type PlanSeason } from "@/lib/season";
import { Screen } from "@/components/ui";
import { HistoryTimeline, type HistoryLog } from "./HistoryTimeline";

const ORDER: Record<string, number> = { spring: 0, autumn: 1, overwinter: 2 };

export default async function HistoryPage({ params, searchParams }: PageProps<"/history/[planCropId]">) {
  const { planCropId } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const today = todayKst();

  const { data: pc } = await supabase
    .from("plan_crops")
    .select("id, plan_id, crop_id, is_companion, crops(id, name), field_plans(id, farm_id, year, season)")
    .eq("id", planCropId)
    .maybeSingle();
  if (!pc) notFound();
  const crop = pc.crops as unknown as { id: string; name: string };
  const plan = pc.field_plans as unknown as { id: string; farm_id: string; year: number; season: PlanSeason };

  const [{ data: plantings }, { data: targets }, claims] = await Promise.all([
    supabase
      .from("plantings")
      .select("id, method, sow_date, transplant_date, status, plant_count, planned_plant_count, crop_varieties(name), planting_cells(cell_id)")
      .eq("plan_crop_id", planCropId)
      .order("created_at"),
    supabase
      .from("work_log_targets")
      .select("work_logs(id, work_date, work_type, memo, rain_mm, is_auto, created_by, work_log_photos(storage_path))")
      .eq("plan_crop_id", planCropId),
    supabase.auth.getClaims(),
  ]);
  const plist = (plantings ?? []) as unknown as {
    id: string;
    method: string | null;
    sow_date: string | null;
    transplant_date: string | null;
    status: string;
    plant_count: number | null;
    planned_plant_count: number | null;
    crop_varieties: { name: string } | null;
    planting_cells: { cell_id: string }[];
  }[];
  const plantingIds = plist.map((p) => p.id);
  const { data: nextTasks } = await supabase
    .from("tasks")
    .select("title, calculated_date, adjusted_date")
    .eq("status", "pending")
    .or(`plan_crop_id.eq.${planCropId}${plantingIds.length ? `,planting_id.in.(${plantingIds.join(",")})` : ""}`);
  const next = (nextTasks ?? []).map((t) => ({ ...t, due: t.adjusted_date ?? t.calculated_date })).sort((a, b) => a.due.localeCompare(b.due))[0];

  const logs = ((targets ?? []) as unknown as { work_logs: HistoryLog }[])
    .map((t) => t.work_logs)
    .filter(Boolean)
    .sort((a, b) => b.work_date.localeCompare(a.work_date));

  // 누른 칸의 지난 작기 작물
  let previous: { label: string; crops: string[] }[] = [];
  const cell = typeof sp.cell === "string" ? sp.cell.split(",").map(Number) : null;
  if (cell && cell.length === 2 && cell.every(Number.isFinite)) {
    const { data: past } = await supabase
      .from("field_plan_cells")
      .select("crops(name), companion:crops!field_plan_cells_companion_crop_id_fkey(name), field_plans!inner(id, farm_id, year, season, status), planting_cells(plantings(crops(name)))")
      .eq("x", cell[0])
      .eq("y", cell[1])
      .eq("field_plans.farm_id", plan.farm_id)
      .eq("field_plans.status", "confirmed")
      .neq("plan_id", plan.id);
    previous = ((past ?? []) as unknown as {
      crops: { name: string };
      companion: { name: string } | null;
      field_plans: { year: number; season: PlanSeason };
      planting_cells: { plantings: { crops: { name: string } } }[];
    }[])
      .filter((r) => r.field_plans.year * 3 + ORDER[r.field_plans.season] < plan.year * 3 + ORDER[plan.season])
      .sort((a, b) => b.field_plans.year * 3 + ORDER[b.field_plans.season] - (a.field_plans.year * 3 + ORDER[a.field_plans.season]))
      .map((r) => ({
        label: `${r.field_plans.year} ${SEASON_LABEL[r.field_plans.season]}`,
        crops: [...new Set([r.crops.name, ...r.planting_cells.map((p) => p.plantings.crops.name), ...(r.companion ? [`${r.companion.name}(사이)`] : [])])],
      }));
  }

  const varieties = [...new Set(plist.map((p) => p.crop_varieties?.name).filter(Boolean))];

  return (
    <Screen title={`${crop.name}${pc.is_companion ? " (사이작물)" : ""}`}>
      <Link href="/" className="text-sm text-primary">
        ← 밭으로
      </Link>
      <section className="flex flex-col gap-1 rounded-lg bg-white p-3 text-sm">
        <p className="text-xs text-neutral-500">
          {plan.year} {SEASON_LABEL[plan.season]} ·{" "}
          <Link href={`/crops/${crop.id}`} className="text-primary underline">
            작물 정보
          </Link>
        </p>
        {varieties.length > 0 && <p>품종: {varieties.join(", ")}</p>}
        {plist.map((p, i) => {
          const date = p.transplant_date ?? p.sow_date;
          const verb = p.method === "direct" || (!p.transplant_date && p.sow_date) ? "파종" : "정식";
          return (
            <p key={p.id}>
              {plist.length > 1 && `${i + 1}회차 · `}
              {date ? `${formatKDate(date)} ${verb} · ${verb} 후 ${diffDays(today, date)}일` : "심은 날짜 미입력"}
              {p.status !== "active" && ` · ${p.status === "ended" ? "종료" : "교체됨"}`}
              <span className="text-xs text-neutral-500"> ({p.planting_cells.length}칸, {p.plant_count ?? p.planned_plant_count ?? "?"}포기)</span>
            </p>
          );
        })}
        {pc.is_companion && <p className="text-xs text-neutral-500">사이작물의 재배 상태는 같은 칸 주작물을 따라요.</p>}
        {next && (
          <p className="font-medium text-primary">
            다음 할 일: {next.title} ({formatKDate(next.due)})
          </p>
        )}
      </section>

      <HistoryTimeline logs={logs} today={today} userId={claims.data?.claims.sub ?? ""} />

      {previous.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">이 자리의 이전 작물</h2>
          <ul className="rounded-lg bg-white p-3 text-sm">
            {previous.map((p) => (
              <li key={p.label}>
                {p.label}: {p.crops.join(", ")}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Screen>
  );
}
