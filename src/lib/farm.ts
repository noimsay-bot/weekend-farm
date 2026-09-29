import type { SupabaseClient } from "@supabase/supabase-js";

export type OnboardingStep = "field" | "planted" | "invite" | "done";

export type Farm = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  width_m: number | null;
  height_m: number | null;
  onboarding_step: OnboardingStep;
  onboarding_has_planted: boolean | null;
};

// 현재는 사용자당 첫 번째로 합류한 농장을 사용한다 (계획서: 농장 1곳).
export async function getCurrentFarm(supabase: SupabaseClient): Promise<Farm | null> {
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("farm_members")
    .select("joined_at, farms(*)")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;

  return (data?.farms as unknown as Farm | undefined) ?? null;
}

export function onboardingPath(step: OnboardingStep): string {
  return step === "done" ? "/" : `/onboarding/${step}`;
}
