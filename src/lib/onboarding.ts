import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentFarm, onboardingPath, type Farm, type OnboardingStep } from "@/lib/farm";

// 온보딩 단계 페이지에서 호출. 현재 농장 단계와 다르면 맞는 단계로 보낸다.
export async function requireOnboardingStep(step: OnboardingStep): Promise<Farm> {
  const farm = await getCurrentFarm(await createClient());
  if (!farm) redirect("/onboarding/farm");
  if (farm.onboarding_step !== step) redirect(onboardingPath(farm.onboarding_step));
  return farm;
}
