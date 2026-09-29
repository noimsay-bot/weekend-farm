"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { resizePhoto } from "@/lib/image";
import { USER_WORK_TYPES, WORK_TYPE_LABEL, type WorkType } from "@/lib/work-types";
import { Button, ErrorText } from "@/components/ui";

export type TargetCrop = { id: string; crop_id: string; crop_name: string; is_companion: boolean };
export type PestOption = {
  id: string;
  crop_id: string;
  pest_name: string;
  ingredient_name: string;
  moa_code: string | null;
  is_organic: boolean;
};

export function LogForm({
  farmId,
  initialDate,
  targets,
  pests,
  onSaved,
}: {
  farmId: string;
  initialDate: string;
  targets: TargetCrop[];
  pests: PestOption[];
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [date, setDate] = useState(initialDate);
  const [type, setType] = useState<WorkType>("watering");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [memo, setMemo] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [pesticides, setPesticides] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const chosenCropIds = new Set(targets.filter((t) => chosen.has(t.id)).map((t) => t.crop_id));
  // 같은 성분은 한 번만 보여준다 (작물마다 등록 행이 있음)
  const pestChoices = [...new Map(pests.filter((p) => chosenCropIds.has(p.crop_id)).map((p) => [p.ingredient_name, p])).values()];

  function toggle(set: Set<string>, id: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  async function save() {
    if (targets.length && chosen.size === 0) return setError("대상 작물을 하나 이상 고르세요.");
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { data: claims } = await supabase.auth.getClaims();
    const { data: log, error } = await supabase
      .from("work_logs")
      .insert({ farm_id: farmId, work_date: date, work_type: type, memo: memo.trim() || null, created_by: claims?.claims.sub })
      .select("id")
      .single();
    if (error || !log) {
      setBusy(false);
      return setError("기록하지 못했어요.");
    }

    const steps: PromiseLike<{ error: unknown }>[] = [];
    if (chosen.size) {
      steps.push(supabase.from("work_log_targets").insert([...chosen].map((id) => ({ work_log_id: log.id, plan_crop_id: id }))));
    }
    if (type === "pest_control" && pesticides.size) {
      // 선택한 성분의 작물별 등록 행 모두 연결 (작용기작 연속 사용 판정용)
      const ingredients = new Set(pestChoices.filter((p) => pesticides.has(p.id)).map((p) => p.ingredient_name));
      const rows = pests.filter((p) => chosenCropIds.has(p.crop_id) && ingredients.has(p.ingredient_name));
      steps.push(supabase.from("work_log_pesticides").insert(rows.map((p) => ({ work_log_id: log.id, pest_control_id: p.id }))));
    }
    const results = await Promise.all(steps);

    let photoFailed = false;
    for (const file of photos) {
      try {
        const { blob, width, height } = await resizePhoto(file);
        const path = `${farmId}/${log.id}/${crypto.randomUUID()}.jpg`;
        const up = await supabase.storage.from("work-photos").upload(path, blob, { contentType: "image/jpeg" });
        if (up.error) throw up.error;
        const ins = await supabase.from("work_log_photos").insert({ work_log_id: log.id, storage_path: path, width, height });
        if (ins.error) throw ins.error;
      } catch {
        photoFailed = true;
      }
    }

    setBusy(false);
    if (results.some((r) => r.error) || photoFailed) {
      setError("기록은 저장했지만 일부(대상·성분·사진)를 저장하지 못했어요.");
      return;
    }
    if (onSaved) return onSaved();
    router.push(`/calendar?m=${date.slice(0, 7)}`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <label className="flex flex-col gap-1">
        <span className="font-medium">날짜</span>
        <input type="date" className="h-11 rounded border border-neutral-300 bg-white px-2 text-base" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>

      <div className="flex flex-col gap-1">
        <span className="font-medium">작업 종류</span>
        <div className="grid grid-cols-3 gap-1">
          {USER_WORK_TYPES.map((t) => (
            <button key={t} className={`h-10 rounded ${type === t ? "bg-primary text-white" : "border bg-white"}`} onClick={() => setType(t)}>
              {WORK_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="font-medium">대상 작물</span>
          {targets.length > 0 && (
            <button
              className="text-primary"
              onClick={() => setChosen(chosen.size === targets.length ? new Set() : new Set(targets.map((t) => t.id)))}
            >
              {chosen.size === targets.length ? "전체 해제" : "전체 선택"}
            </button>
          )}
        </div>
        {targets.length === 0 && <p className="text-neutral-500">재배 중인 작물이 없어요. 계획을 확정하고 심은 날짜를 입력하세요.</p>}
        <div className="flex flex-wrap gap-2">
          {targets.map((t) => (
            <button
              key={t.id}
              className={`rounded-full px-3 py-2 ${chosen.has(t.id) ? "bg-primary text-white" : "border bg-white"}`}
              onClick={() => toggle(chosen, t.id, setChosen)}
            >
              {t.crop_name}
              {t.is_companion ? " (사이)" : ""}
            </button>
          ))}
        </div>
      </div>

      {type === "pest_control" && (
        <div className="flex flex-col gap-1">
          <span className="font-medium">사용 성분</span>
          {pestChoices.length === 0 && <p className="text-neutral-500">대상 작물을 고르면 등록 성분이 보여요.</p>}
          {pestChoices.map((p) => (
            <label key={p.id} className="flex items-center gap-2 rounded bg-white p-2">
              <input type="checkbox" checked={pesticides.has(p.id)} onChange={() => toggle(pesticides, p.id, setPesticides)} />
              <span>
                {p.ingredient_name}
                <span className="text-xs text-neutral-500"> · 작용기작 {p.moa_code ?? "정보 없음"}{p.is_organic ? " · 친환경" : ""}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className="font-medium">메모</span>
        <textarea className="min-h-20 rounded border border-neutral-300 bg-white p-2 text-base" value={memo} onChange={(e) => setMemo(e.target.value)} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-medium">사진</span>
        <input type="file" accept="image/*" multiple onChange={(e) => setPhotos([...(e.target.files ?? [])])} />
        {photos.length > 0 && <span className="text-xs text-neutral-500">{photos.length}장 · 올리기 전에 작게 줄여요</span>}
      </label>

      <ErrorText>{error}</ErrorText>
      <Button onClick={save} disabled={busy}>
        {busy ? "저장 중…" : "기록 저장"}
      </Button>
    </div>
  );
}
