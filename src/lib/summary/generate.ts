// 계획의 plan_crops별 결산을 만들어 저장한다 (사용자 세션·크론 공용). 대표 사진 선택은 유지된다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSeasonSummary } from "./build";

export async function generateSeasonSummaries(db: SupabaseClient, planId: string): Promise<number> {
  const [{ data: planCrops }, { data: plantings }, { data: cells }] = await Promise.all([
    db.from("plan_crops").select("id, crop_id, is_companion, crops(name)").eq("plan_id", planId),
    db
      .from("plantings")
      .select("id, plan_crop_id, sow_date, transplant_date, method, status, crop_varieties(name), planting_cells(cell_id)")
      .eq("plan_id", planId),
    db.from("field_plan_cells").select("id, companion_crop_id").eq("plan_id", planId),
  ]);
  type P = {
    id: string;
    plan_crop_id: string;
    sow_date: string | null;
    transplant_date: string | null;
    method: string | null;
    status: string;
    crop_varieties: { name: string } | null;
    planting_cells: { cell_id: string }[];
  };
  const plist = (plantings ?? []) as unknown as P[];
  let saved = 0;

  for (const pc of (planCrops ?? []) as unknown as { id: string; crop_id: string; is_companion: boolean; crops: { name: string } }[]) {
    // 사이작물은 같은 칸 주작물 식재를 따른다
    const mine = pc.is_companion
      ? plist.filter((p) => p.planting_cells.some((c) => (cells ?? []).find((x) => x.id === c.cell_id)?.companion_crop_id === pc.crop_id))
      : plist.filter((p) => p.plan_crop_id === pc.id);
    const ids = mine.map((p) => p.id);

    const [{ data: targets }, { data: tasks }] = await Promise.all([
      db
        .from("work_log_targets")
        .select("work_logs(work_date, work_type, memo, rain_mm, is_auto, work_log_pesticides(crop_pest_controls(ingredient_name)))")
        .eq("plan_crop_id", pc.id),
      db
        .from("tasks")
        .select("task_type, title, calculated_date, adjusted_date, status, work_logs:done_work_log_id(work_date)")
        .or(`plan_crop_id.eq.${pc.id}${ids.length ? `,planting_id.in.(${ids.join(",")})` : ""}`),
    ]);

    const summary = buildSeasonSummary({
      cropName: pc.crops.name,
      isCompanion: pc.is_companion,
      plantings: mine.map((p) => ({
        sow_date: p.sow_date,
        transplant_date: p.transplant_date,
        method: p.method,
        variety: p.crop_varieties?.name ?? null,
        status: p.status,
      })),
      logs: ((targets ?? []) as unknown as {
        work_logs: {
          work_date: string;
          work_type: string;
          memo: string | null;
          rain_mm: number | null;
          is_auto: boolean;
          work_log_pesticides: { crop_pest_controls: { ingredient_name: string } }[];
        } | null;
      }[])
        .map((t) => t.work_logs)
        .filter((l): l is NonNullable<typeof l> => Boolean(l))
        .map((l) => ({ ...l, ingredients: l.work_log_pesticides.map((p) => p.crop_pest_controls.ingredient_name) })),
      doneTasks: ((tasks ?? []) as unknown as {
        task_type: string;
        title: string;
        calculated_date: string;
        adjusted_date: string | null;
        status: string;
        work_logs: { work_date: string } | null;
      }[])
        .filter((t) => t.status === "done")
        .map((t) => ({ ...t, done_date: t.work_logs?.work_date ?? null })),
    });

    const { error } = await db.from("season_summaries").upsert({ plan_id: planId, plan_crop_id: pc.id, summary }, { onConflict: "plan_crop_id" });
    if (!error) saved++;
  }
  return saved;
}
