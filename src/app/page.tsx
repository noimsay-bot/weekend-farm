import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentFarm, onboardingPath } from "@/lib/farm";

// 홈: 온보딩 미완료면 해당 단계로, 완료면 계획 화면으로.
// (재배 중 식재가 있을 때의 대시보드 분기는 P9에서 추가)
export default async function Home() {
  const farm = await getCurrentFarm(await createClient());
  if (!farm) redirect("/onboarding/farm");
  if (farm.onboarding_step !== "done") redirect(onboardingPath(farm.onboarding_step));
  redirect(farm.onboarding_has_planted ? "/plan?season=current" : "/plan?season=next");
}
