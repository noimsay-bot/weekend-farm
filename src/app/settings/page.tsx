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
    </Screen>
  );
}
