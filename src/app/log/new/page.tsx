import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentFarm } from "@/lib/farm";
import { todayKst } from "@/lib/season";
import { Screen } from "@/components/ui";
import { LogForm, type TargetCrop, type PestOption } from "./LogForm";

export default async function NewLogPage({ searchParams }: PageProps<"/log/new">) {
  const supabase = await createClient();
  const farm = await getCurrentFarm(supabase);
  if (!farm) redirect("/onboarding/farm");

  const sp = await searchParams;
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayKst();

  const { data: targets } = await supabase
    .from("active_plan_crops")
    .select("id, crop_id, crop_name, is_companion")
    .eq("farm_id", farm.id)
    .order("crop_name");
  const cropIds = [...new Set((targets ?? []).map((t) => t.crop_id))];
  const { data: pests } = await supabase
    .from("crop_pest_controls")
    .select("id, crop_id, pest_name, ingredient_name, moa_code, is_organic")
    .in("crop_id", cropIds.length ? cropIds : ["00000000-0000-0000-0000-000000000000"])
    .order("ingredient_name");

  return (
    <Screen title="작업 기록">
      <LogForm
        farmId={farm.id}
        initialDate={date}
        targets={(targets ?? []) as TargetCrop[]}
        pests={(pests ?? []) as PestOption[]}
      />
    </Screen>
  );
}
