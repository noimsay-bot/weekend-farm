"use client";

import { SEASON_LABEL, type PlanSeason } from "@/lib/season";
import type { CompanionHit } from "@/lib/companions";
import type { PickerCrop } from "./CropPicker";
import type { CellRow } from "./PlanEditor";

export type RotationWarning = {
  x: number;
  y: number;
  crop_id: string;
  family_id: string;
  prev_plan_id: string;
  prev_year: number;
  prev_season: PlanSeason;
  prev_crop_id: string;
};

export type Family = {
  id: string;
  name: string;
  soil_diseases: string | null;
  soil_treatment_ingredients: string[] | null;
  lime_ph_guide: string | null;
  drainage_guide: string | null;
  source_url: string | null;
};

export function WarningDetail({
  pos,
  cell,
  cropById,
  warnings,
  hits,
  families,
  onClose,
}: {
  pos: { x: number; y: number };
  cell: CellRow | null;
  cropById: Map<string, PickerCrop>;
  warnings: RotationWarning[];
  hits: CompanionHit[];
  families: Family[];
  onClose: () => void;
}) {
  const name = (id: string | null | undefined) => (id ? (cropById.get(id)?.name ?? "알 수 없는 작물") : "");
  const family = warnings[0] ? families.find((f) => f.id === warnings[0].family_id) : null;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-300 bg-white p-3 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">
          칸 ({pos.x + 1}, {pos.y + 1}) {cell ? `· ${name(cell.crop_id)}` : "· 빈 칸"}
          {cell?.companion_crop_id && ` + ${name(cell.companion_crop_id)}`}
        </h3>
        <button className="text-neutral-500" onClick={onClose}>
          닫기
        </button>
      </div>
      {cell?.carry_state === "carried_occupied" && (
        <p className="text-neutral-600">🔒 지난 작기에서 이어지는 칸이에요. 수확(여러해살이는 식재 종료)하면 풀려요.</p>
      )}

      {warnings.length > 0 && (
        <div className="flex flex-col gap-2 rounded bg-red-50 p-2">
          <p className="font-medium text-red-800">연작 주의 {family ? `(${family.name})` : ""}</p>
          {warnings.map((w) => (
            <p key={w.prev_plan_id} className="text-red-900">
              {w.prev_year} {SEASON_LABEL[w.prev_season]}에 같은 과 작물 {name(w.prev_crop_id)}을(를) 심었어요.
            </p>
          ))}
          {family && (
            <div className="flex flex-col gap-1 text-xs text-neutral-700">
              <p className="font-medium">밭만들기 때 할 예방조치 (피해를 줄인다)</p>
              {family.soil_diseases && <p>주요 토양 병해: {family.soil_diseases}</p>}
              {family.soil_treatment_ingredients?.length ? <p>토양 처리 약제 성분: {family.soil_treatment_ingredients.join(", ")}</p> : null}
              {family.lime_ph_guide && <p>석회·산도: {family.lime_ph_guide}</p>}
              {family.drainage_guide && <p>배수: {family.drainage_guide}</p>}
              {!family.soil_diseases && !family.soil_treatment_ingredients?.length && !family.lime_ph_guide && !family.drainage_guide && (
                <p>이 과의 예방조치 자료가 아직 없어요.</p>
              )}
              {family.source_url && (
                <a href={family.source_url} target="_blank" rel="noreferrer" className="text-primary underline">
                  출처
                </a>
              )}
            </div>
          )}
          <p className="text-xs text-neutral-500">경고만 하고 막지 않아요. 확정하면 밭만들기 작업에 예방조치 체크 항목이 추가돼요.</p>
        </div>
      )}

      {hits.map((h, i) => (
        <div key={i} className={`rounded p-2 ${h.companion.relation === "bad" ? "bg-amber-50" : "bg-green-50"}`}>
          <p className="font-medium">
            {h.companion.relation === "bad" ? "궁합 나쁨" : "궁합 좋음"}: {name(h.companion.crop_a_id)} – {name(h.companion.crop_b_id)}
            {h.sameCell ? " (같은 칸)" : ""}
          </p>
          {h.companion.reason && <p className="text-neutral-700">{h.companion.reason}</p>}
          {h.companion.source_text && <p className="mt-1 text-xs text-neutral-500">&ldquo;{h.companion.source_text}&rdquo;</p>}
          {h.companion.source_url && (
            <a href={h.companion.source_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
              출처
            </a>
          )}
        </div>
      ))}

      {warnings.length === 0 && hits.length === 0 && cell && <p className="text-neutral-500">경고 없음</p>}
    </section>
  );
}
