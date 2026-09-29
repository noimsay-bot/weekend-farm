import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentFarm } from "@/lib/farm";
import { Screen } from "@/components/ui";
import { FertilizerSettings } from "./FertilizerSettings";

export default async function FertilizerSettingsPage() {
  const supabase = await createClient();
  const farm = await getCurrentFarm(supabase);
  if (!farm) redirect("/onboarding/farm");
  const [{ data: products }, { data: settings }] = await Promise.all([
    supabase.from("fertilizer_products").select("id, farm_id, name, n_pct, p_pct, k_pct, is_default").order("created_at"),
    supabase.from("farm_fertilizer_settings").select("usage, product_id").eq("farm_id", farm.id),
  ]);
  return (
    <Screen title="비료 제품">
      <Link href="/settings" className="text-sm text-primary">
        ← 설정
      </Link>
      <FertilizerSettings farmId={farm.id} products={products ?? []} settings={settings ?? []} />
    </Screen>
  );
}
