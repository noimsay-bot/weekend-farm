import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { REQUIRED_CROP_FIELDS } from "@/lib/crop-fields";
import { Screen } from "@/components/ui";
import { ClaimAdmin } from "./ClaimAdmin";
import { ApproveToggle } from "./ApproveToggle";

type CropRow = { id: string; name: string; status: string; source_url: string | null };
type SourceRow = { crop_id: string; field_name: string; approved: boolean; manual_input: boolean };

export default async function AdminCropsPage() {
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_app_admin");

  if (!isAdmin) {
    return (
      <Screen title="작물 데이터 관리">
        <p className="text-sm text-neutral-600">앱 관리자만 볼 수 있어요.</p>
        <ClaimAdmin />
      </Screen>
    );
  }

  const [{ data: crops }, { data: sources }] = await Promise.all([
    supabase.from("crops").select("id, name, status, source_url").order("name"),
    supabase.from("crop_field_sources").select("crop_id, field_name, approved, manual_input"),
  ]);

  const required = new Set(REQUIRED_CROP_FIELDS.map((f) => f.name));
  const done = new Map<string, number>();
  for (const s of (sources ?? []) as SourceRow[]) {
    if (required.has(s.field_name) && (s.approved || s.manual_input)) {
      done.set(s.crop_id, (done.get(s.crop_id) ?? 0) + 1);
    }
  }
  const list = (crops ?? []) as CropRow[];
  const confirmed = list.filter((c) => c.status === "confirmed").length;

  return (
    <Screen title="작물 데이터 관리">
      <p className="text-sm text-neutral-600">
        승인 {confirmed} / 전체 {list.length}종. 원문이 있는 작물은 &lsquo;승인&rsquo;을 누르면 원문에서 뽑은 값이 승인되고, 원문에 없는 값은 비워
        둔 채(앱에서 &lsquo;모름&rsquo;으로 처리) 앱에 나타나요. 다시 누르면 승인이 취소돼요. 작물 이름을 누르면 값을 자세히 보고 채울 수 있어요.
      </p>
      <ul className="flex flex-col divide-y rounded-lg bg-white">
        {list.map((c) => (
          <li key={c.id} className="flex items-center gap-2 px-4 py-2">
            <Link href={`/admin/crops/${c.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-2 py-1">
              <span className="truncate font-medium">{c.name}</span>
              <span className="shrink-0 text-xs text-neutral-500">
                {done.get(c.id) ?? 0}/{required.size}
              </span>
            </Link>
            <ApproveToggle cropId={c.id} confirmed={c.status === "confirmed"} hasSource={Boolean(c.source_url)} />
          </li>
        ))}
      </ul>
      {list.length === 0 && (
        <p className="text-sm text-neutral-500">아직 수집된 작물이 없어요. 수집 스크립트(npm run collect)를 먼저 실행하세요.</p>
      )}
    </Screen>
  );
}
