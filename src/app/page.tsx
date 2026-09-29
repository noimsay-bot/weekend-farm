import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentFarm, onboardingPath } from "@/lib/farm";
import { todayKst } from "@/lib/season";
import { loadDashboard } from "./_dashboard/load";
import { Dashboard } from "./_dashboard/Dashboard";

// 홈: 재배 중(심은 날짜가 있는) 식재가 있으면 밭 대시보드, 없으면 계획 편집 화면
export default async function Home() {
  const supabase = await createClient();
  const farm = await getCurrentFarm(supabase);
  if (!farm) redirect("/onboarding/farm");
  if (farm.onboarding_step !== "done") redirect(onboardingPath(farm.onboarding_step));

  const today = todayKst();
  const data = await loadDashboard(supabase, farm.id, today);
  if (!data) {
    // 심은 게 없으면 계획 편집. 온보딩에서 '심어진 작물 있음'이면 이번 작기부터.
    redirect(farm.onboarding_has_planted ? "/plan?season=current" : "/plan?season=next");
  }
  return <Dashboard data={data} />;
}
