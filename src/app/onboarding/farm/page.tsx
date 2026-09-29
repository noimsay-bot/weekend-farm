import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentFarm, onboardingPath } from "@/lib/farm";
import { FarmForm } from "./FarmForm";

export default async function OnboardingFarmPage() {
  const farm = await getCurrentFarm(await createClient());
  if (farm) redirect(onboardingPath(farm.onboarding_step));
  return <FarmForm />;
}
