import { requireOnboardingStep } from "@/lib/onboarding";
import { Screen } from "@/components/ui";
import { SizeForm } from "./SizeForm";

// 가상 밭 격자 편집은 P3에서 구현. 지금은 밭 크기만 받는다.
export default async function OnboardingFieldPage() {
  const farm = await requireOnboardingStep("field");
  return (
    <Screen title="밭 크기">
      <p className="text-sm text-neutral-600">
        걸음으로 재도 괜찮아요. 한 걸음은 보통 0.6~0.7m예요.
      </p>
      <SizeForm farmId={farm.id} />
    </Screen>
  );
}
