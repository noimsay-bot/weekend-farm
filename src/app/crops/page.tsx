import { createClient } from "@/lib/supabase/server";
import { Screen } from "@/components/ui";
import { CropIndex, type CropCard } from "./CropIndex";

export default async function CropsPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("crops").select("id, name, category, description").eq("status", "confirmed").order("name");
  return (
    <Screen title="작물 백과">
      <CropIndex crops={(data ?? []) as CropCard[]} />
    </Screen>
  );
}
