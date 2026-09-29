import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentFarm } from "@/lib/farm";
import { Screen } from "@/components/ui";
import { FarmSettingsForm, type FarmSettings } from "./FarmSettingsForm";

export default async function FarmSettingsPage() {
  const supabase = await createClient();
  const farm = await getCurrentFarm(supabase);
  if (!farm) redirect("/onboarding/farm");
  const { data } = await supabase.from("farm_settings").select("*").eq("farm_id", farm.id).single();

  return (
    <Screen title="농장 기준값">
      <Link href="/settings" className="text-sm text-primary">
        ← 설정
      </Link>
      <FarmSettingsForm farmId={farm.id} initial={data as FarmSettings} size={{ width: farm.width_m, height: farm.height_m }} />
    </Screen>
  );
}
