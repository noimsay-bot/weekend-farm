import { Screen } from "@/components/ui";
import { AcceptInvite } from "./AcceptInvite";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  return (
    <Screen title="농장 초대">
      <p className="text-sm text-neutral-600">초대받은 농장에 합류합니다.</p>
      <AcceptInvite token={token} />
    </Screen>
  );
}
