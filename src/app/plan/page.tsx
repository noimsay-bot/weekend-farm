import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentFarm, onboardingPath } from "@/lib/farm";
import { Screen } from "@/components/ui";
import { InviteLink } from "@/components/InviteLink";
import { SignOut } from "./SignOut";

// 계획 편집 화면 자리. 격자 계획은 P3에서 구현한다.
export default async function PlanPage({ searchParams }: PageProps<"/plan">) {
  const supabase = await createClient();
  const farm = await getCurrentFarm(supabase);
  if (!farm) redirect("/onboarding/farm");
  if (farm.onboarding_step !== "done") redirect(onboardingPath(farm.onboarding_step));

  const { season } = await searchParams;
  const { data: members } = await supabase
    .from("farm_members")
    .select("user_id, role")
    .eq("farm_id", farm.id);

  return (
    <Screen title={farm.name}>
      <section className="rounded-lg bg-white p-4 text-sm">
        <p className="font-semibold">
          {season === "current" ? "지금 작기 계획" : "다음 작기 계획"}
        </p>
        <p className="mt-1 text-neutral-500">격자 계획 편집은 다음 단계에서 준비됩니다.</p>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">멤버 {members?.length ?? 0}명</h2>
        <InviteLink farmId={farm.id} />
      </section>
      <Link
        href="/settings"
        className="flex h-12 items-center justify-center rounded-lg border border-primary bg-white font-semibold text-primary"
      >
        농장 설정 (위치 수정)
      </Link>
      <SignOut />
    </Screen>
  );
}
