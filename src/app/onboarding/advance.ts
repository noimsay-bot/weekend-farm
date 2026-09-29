"use client";

import { createClient } from "@/lib/supabase/client";
import type { OnboardingStep } from "@/lib/farm";

export async function advanceOnboarding(
  farmId: string,
  patch: { onboarding_step: OnboardingStep; onboarding_has_planted?: boolean },
) {
  const { error } = await createClient().from("farms").update(patch).eq("id", farmId);
  if (error) throw error;
}
