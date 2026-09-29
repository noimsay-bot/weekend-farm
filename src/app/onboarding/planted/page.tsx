import { requireOnboardingStep } from "@/lib/onboarding";
import { Screen } from "@/components/ui";
import { PlantedChoice } from "./PlantedChoice";

export default async function OnboardingPlantedPage() {
  const farm = await requireOnboardingStep("planted");
  return (
    <Screen title="지금 심어진 작물이 있나요?">
      <p className="text-sm text-neutral-600">
        있으면 지금 작기 계획을 칠하고 심은 날짜를 입력해요. 없으면 다음 작기 계획을 만들어요.
      </p>
      <PlantedChoice farmId={farm.id} />
    </Screen>
  );
}
