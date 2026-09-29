import { requireOnboardingStep } from "@/lib/onboarding";
import { Screen } from "@/components/ui";
import { InviteLink } from "@/components/InviteLink";
import { FinishOnboarding } from "./FinishOnboarding";

export default async function OnboardingInvitePage() {
  const farm = await requireOnboardingStep("invite");
  return (
    <Screen title="함께 가꿀 사람 초대">
      <p className="text-sm text-neutral-600">
        초대받은 사람은 자기 이메일로 로그인한 뒤 같은 농장을 함께 봅니다.
      </p>
      <InviteLink farmId={farm.id} />
      <FinishOnboarding farmId={farm.id} hasPlanted={farm.onboarding_has_planted ?? false} />
    </Screen>
  );
}
