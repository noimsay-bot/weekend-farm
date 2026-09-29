import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentFarm } from "@/lib/farm";
import { Screen } from "@/components/ui";
import { FarmSettingsForm, type FarmSettings } from "./FarmSettingsForm";
import { BadgeLeadSettings } from "./BadgeLeadSettings";

export default async function FarmSettingsPage() {
  const supabase = await createClient();
  const farm = await getCurrentFarm(supabase);
  if (!farm) redirect("/onboarding/farm");
  const [{ data }, { data: leads }] = await Promise.all([
    supabase.from("farm_settings").select("*").eq("farm_id", farm.id).single(),
    supabase.from("dashboard_settings").select("task_type, badge_lead_days").eq("farm_id", farm.id),
  ]);

  return (
    <Screen title="농장 기준값">
      <Link href="/settings" className="text-sm text-primary">
        ← 설정
      </Link>
      <FarmSettingsForm farmId={farm.id} initial={data as FarmSettings} size={{ width: farm.width_m, height: farm.height_m }} />
      <BadgeLeadSettings farmId={farm.id} initial={Object.fromEntries((leads ?? []).map((l) => [l.task_type, l.badge_lead_days]))} />
    </Screen>
  );
}
