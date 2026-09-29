import { requireOnboardingStep } from "@/lib/onboarding";
import { Screen } from "@/components/ui";
import { NextStep } from "./NextStep";

// 가상 밭 격자 편집은 P3에서 구현. 지금은 농장 크기만 확인하고 넘어간다.
export default async function OnboardingFieldPage() {
  const farm = await requireOnboardingStep("field");
  return (
    <Screen title="가상 밭">
      <div className="rounded-lg border border-dashed border-primary bg-white p-6 text-center text-sm">
        <p className="font-semibold">
          {farm.name} · {Number(farm.width_m)}m × {Number(farm.height_m)}m
        </p>
        <p className="mt-2 text-neutral-500">격자 밭 편집은 다음 단계에서 준비됩니다.</p>
      </div>
      <NextStep farmId={farm.id} />
    </Screen>
  );
}
