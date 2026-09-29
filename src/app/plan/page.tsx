import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentFarm, onboardingPath } from "@/lib/farm";
import { nextSeason, seasonLabel, seasonOf, todayKst, type PlanSeason, type SeasonKey } from "@/lib/season";
import { Screen } from "@/components/ui";
import { InviteLink } from "@/components/InviteLink";
import { SignOut } from "./SignOut";

type PlanRow = { id: string; year: number; season: PlanSeason; status: string };

const STATUS_LABEL: Record<string, string> = {
  draft: "초안",
  pending_approval: "확정 대기",
  confirmed: "확정",
};

function planHref(plans: PlanRow[], key: SeasonKey) {
  const found = plans.find((p) => p.year === key.year && p.season === key.season);
  return found ? `/plan/${found.id}` : `/plan/new?year=${key.year}&season=${key.season}`;
}

export default async function PlanListPage({ searchParams }: PageProps<"/plan">) {
  const supabase = await createClient();
  const farm = await getCurrentFarm(supabase);
  if (!farm) redirect("/onboarding/farm");
  if (farm.onboarding_step !== "done") redirect(onboardingPath(farm.onboarding_step));

  const [{ data: plans }, { data: members }] = await Promise.all([
    supabase.from("field_plans").select("id, year, season, status").eq("farm_id", farm.id).order("year", { ascending: false }),
    supabase.from("farm_members").select("user_id").eq("farm_id", farm.id),
  ]);
  const list = (plans ?? []) as PlanRow[];
  const current = seasonOf(todayKst());
  const next = nextSeason(current);

  // 온보딩·홈에서 ?season=current|next로 들어오면 해당 계획(없으면 생성 화면)으로 보낸다.
  const { season } = await searchParams;
  if (season === "current") redirect(planHref(list, current));
  if (season === "next") redirect(planHref(list, next));

  const order = { spring: 0, autumn: 1, overwinter: 2 };
  list.sort((a, b) => b.year - a.year || order[b.season] - order[a.season]);

  return (
    <Screen title={farm.name}>
      <section className="grid grid-cols-2 gap-3">
        <Link href={planHref(list, current)} className="rounded-lg bg-primary p-4 text-white">
          <p className="text-xs opacity-80">지금 작기</p>
          <p className="font-semibold">{seasonLabel(current)}</p>
        </Link>
        <Link href={planHref(list, next)} className="rounded-lg border border-primary bg-white p-4 text-primary">
          <p className="text-xs opacity-80">다음 작기</p>
          <p className="font-semibold">{seasonLabel(next)}</p>
        </Link>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">모든 계획</h2>
          <Link href="/plan/new" className="text-sm text-primary">
            + 새 계획
          </Link>
        </div>
        {list.length === 0 && <p className="text-sm text-neutral-500">아직 계획이 없어요.</p>}
        <ul className="flex flex-col divide-y rounded-lg bg-white">
          {list.map((p) => (
            <li key={p.id}>
              <Link href={`/plan/${p.id}`} className="flex items-center justify-between px-4 py-3">
                <span>{seasonLabel(p)}</span>
                <span className="text-xs text-neutral-500">{STATUS_LABEL[p.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">멤버 {members?.length ?? 0}명</h2>
        <InviteLink farmId={farm.id} />
      </section>
      <Link
        href="/settings"
        className="flex h-12 items-center justify-center rounded-lg border border-primary bg-white font-semibold text-primary"
      >
        농장 설정
      </Link>
      <SignOut />
    </Screen>
  );
}
