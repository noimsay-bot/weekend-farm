import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentFarm } from "@/lib/farm";
import { Screen } from "@/components/ui";
import { LocationForm } from "./LocationForm";

export default async function SettingsPage() {
  const farm = await getCurrentFarm(await createClient());
  if (!farm) redirect("/onboarding/farm");

  return (
    <Screen title="농장 설정">
      <Link href="/" className="text-sm text-primary">
        ← 돌아가기
      </Link>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">텃밭 위치</h2>
        <p className="text-xs text-neutral-500">
          밭에서 &lsquo;현재 위치로 설정&rsquo;을 누르면 가장 정확해요.
        </p>
        <LocationForm farmId={farm.id} initial={{ lat: farm.lat, lng: farm.lng }} />
      </section>
      <nav className="flex flex-col divide-y rounded-lg bg-white text-sm">
        {[
          ["/settings/farm", "농장 기준값 (밭 크기·칸·비 판정)"],
          ["/settings/fertilizer", "비료 제품 (밑거름·추비)"],
          ["/settings/notifications", "알림 설정"],
          ["/settings/routine", "밭 도착 시 자동 열기 (갤럭시 루틴)"],
          ["/plan", "계획 목록·멤버 초대"],
          ["/admin/crops", "작물 데이터 관리 (관리자)"],
        ].map(([href, label]) => (
          <Link key={href} href={href} className="flex items-center justify-between px-4 py-3">
            <span>{label}</span>
            <span className="text-neutral-400">›</span>
          </Link>
        ))}
      </nav>
    </Screen>
  );
}
