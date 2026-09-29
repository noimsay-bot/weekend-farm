import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentFarm } from "@/lib/farm";
import { addDays } from "@/lib/dates";
import { todayKst } from "@/lib/season";
import { Screen } from "@/components/ui";
import { MonthCalendar, type CalLog, type CalTask } from "./MonthCalendar";

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const supabase = await createClient();
  const farm = await getCurrentFarm(supabase);
  if (!farm) redirect("/onboarding/farm");

  const sp = await searchParams;
  const today = todayKst();
  const month = typeof sp.m === "string" && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : today.slice(0, 7);
  const start = `${month}-01`;
  const end = addDays(addDays(start, 31).slice(0, 7) + "-01", -1);

  const [{ data: tasks }, { data: logs }, claims] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, task_type, title, calculated_date, adjusted_date, status, details, planting_id, plantings(crops(schedule_tolerance_days))")
      .eq("farm_id", farm.id)
      .neq("status", "cancelled")
      .or(`and(calculated_date.gte.${start},calculated_date.lte.${end}),and(adjusted_date.gte.${start},adjusted_date.lte.${end})`),
    supabase
      .from("work_logs")
      .select("id, work_date, work_type, memo, rain_mm, is_auto, created_by, work_log_targets(plan_crops(crops(name))), work_log_photos(id, storage_path)")
      .eq("farm_id", farm.id)
      .gte("work_date", start)
      .lte("work_date", end)
      .order("created_at", { ascending: false }),
    supabase.auth.getClaims(),
  ]);

  return (
    <Screen title="캘린더">
      <MonthCalendar
        month={month}
        today={today}
        userId={claims.data?.claims.sub ?? ""}
        tasks={(tasks ?? []) as unknown as CalTask[]}
        logs={(logs ?? []) as unknown as CalLog[]}
      />
    </Screen>
  );
}
