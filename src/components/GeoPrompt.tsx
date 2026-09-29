"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { shouldPrompt, withinRadius } from "@/lib/geofence";
import { todayKst } from "@/lib/season";
import { LogForm, type PestOption, type TargetCrop } from "@/app/log/new/LogForm";

const KEY = "weekend-farm:geo-prompt";
const HIDDEN = ["/login", "/onboarding", "/invite", "/log"];

function lastShown(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function markShown(date: string) {
  try {
    localStorage.setItem(KEY, date);
  } catch {
    // 저장소를 못 쓰면 이번 세션에서만 숨김
  }
}

type Sheet = { farmId: string; targets: TargetCrop[]; pests: PestOption[] };

// 앱이 앞으로 나올 때 농장 반경 안인지 확인. 위치 권한이 없거나 거부되면 조용히 건너뛴다.
export function GeoPrompt() {
  const pathname = usePathname();
  const [sheet, setSheet] = useState<Sheet | null>(null);

  const check = useCallback(async () => {
    const today = todayKst();
    if (lastShown() === today || !("geolocation" in navigator)) return;
    if (navigator.permissions) {
      const p = await navigator.permissions.query({ name: "geolocation" }).catch(() => null);
      if (p?.state === "denied") return;
    }
    const supabase = createClient();
    const { data: claims } = await supabase.auth.getClaims();
    const userId = claims?.claims.sub;
    if (!userId) return;
    const { data: member } = await supabase
      .from("farm_members")
      .select("farms(id, lat, lng, farm_settings(geofence_radius_m))")
      .eq("user_id", userId)
      .order("joined_at")
      .limit(1)
      .maybeSingle();
    const farm = member?.farms as unknown as { id: string; lat: number; lng: number; farm_settings: { geofence_radius_m: number } | null } | null;
    if (!farm) return;

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const inside = withinRadius({ lat: pos.coords.latitude, lng: pos.coords.longitude }, farm, farm.farm_settings?.geofence_radius_m ?? 200);
        if (!inside) return;
        const { data: logs } = await supabase
          .from("work_logs")
          .select("id")
          .eq("farm_id", farm.id)
          .eq("work_date", today)
          .eq("created_by", userId)
          .eq("is_auto", false)
          .limit(1);
        if (!shouldPrompt({ today, lastShownOn: lastShown(), inside, hasMyLogToday: Boolean(logs?.length) })) return;
        const { data: targets } = await supabase.from("active_plan_crops").select("id, crop_id, crop_name, is_companion").eq("farm_id", farm.id);
        const cropIds = [...new Set((targets ?? []).map((t) => t.crop_id))];
        const { data: pests } = cropIds.length
          ? await supabase.from("crop_pest_controls").select("id, crop_id, pest_name, ingredient_name, moa_code, is_organic, safe_days_before_harvest").in("crop_id", cropIds)
          : { data: [] };
        markShown(today);
        setSheet({ farmId: farm.id, targets: (targets ?? []) as TargetCrop[], pests: (pests ?? []) as PestOption[] });
      },
      () => {},
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 },
    );
  }, []);

  useEffect(() => {
    if (HIDDEN.some((h) => pathname.startsWith(h))) return;
    void check();
    const onVisible = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [pathname, check]);

  if (!sheet) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={() => setSheet(null)}>
      <div className="mx-auto max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-background p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">밭에 오셨네요! 오늘 한 일을 남길까요?</h2>
          <button className="text-sm text-neutral-500" onClick={() => setSheet(null)}>
            닫기
          </button>
        </div>
        <LogForm farmId={sheet.farmId} initialDate={todayKst()} targets={sheet.targets} pests={sheet.pests} onSaved={() => setSheet(null)} />
      </div>
    </div>
  );
}
