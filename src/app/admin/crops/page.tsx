import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { REQUIRED_CROP_FIELDS } from "@/lib/crop-fields";
import { Screen } from "@/components/ui";
import { ClaimAdmin } from "./ClaimAdmin";

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
        확정 {confirmed} / 전체 {list.length}종. 필수 {required.size}개 필드를 모두 승인하거나 직접 입력하면 확정할 수 있어요.
      </p>
      <ul className="flex flex-col divide-y rounded-lg bg-white">
        {list.map((c) => {
          const n = done.get(c.id) ?? 0;
          return (
            <li key={c.id}>
              <Link href={`/admin/crops/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="font-medium">{c.name}</span>
                <span className="flex items-center gap-2 text-xs">
                  {!c.source_url && <span className="text-amber-700">원문 없음</span>}
                  <span className="text-neutral-500">
                    {n}/{required.size}
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 ${
                      c.status === "confirmed" ? "bg-primary text-white" : "bg-neutral-200 text-neutral-700"
                    }`}
                  >
                    {c.status === "confirmed" ? "확정" : "검토 중"}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {list.length === 0 && (
        <p className="text-sm text-neutral-500">아직 수집된 작물이 없어요. 수집 스크립트(npm run collect)를 먼저 실행하세요.</p>
      )}
    </Screen>
  );
}
