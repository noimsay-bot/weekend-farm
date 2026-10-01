"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { bedLength, type Bed, type BedPlanting, type SowPattern } from "@/lib/field/beds";
import { toneMap } from "@/lib/field/colors";
import { regenerateTasks } from "@/lib/planting/tasks";
import { FieldMap } from "@/components/FieldMap";
import { Button, ErrorText } from "@/components/ui";
import { PlantingPanel, patternsFor, rowsFor, type Sowing } from "@/app/plan/[id]/BedPlanEditor";

const DRAFT = "draft";

export function PlacePlanting({
  plantingId,
  cropId,
  cropName,
  method,
  plantCount,
  current,
  widthCm,
  heightCm,
  beds,
  others,
  cropNames,
  spacing,
  sowing,
}: {
  plantingId: string;
  cropId: string;
  cropName: string;
  method: "direct" | "transplant" | null;
  plantCount: number | null;
  current: BedPlanting | null;
  widthCm: number;
  heightCm: number;
  beds: Bed[];
  others: BedPlanting[];
  cropNames: Record<string, string>;
  spacing: Record<string, number | null>;
  sowing: Record<string, Sowing>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<BedPlanting | null>(current ? { ...current, id: DRAFT } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const s = sowing[cropId];
  const bed = beds.find((b) => b.id === draft?.bed_id) ?? null;

  // 정식했으면 모종 심기, 파종했으면 작물의 기본 파종 방식
  function defaultMethod(): SowPattern {
    const allowed = patternsFor(s);
    if (allowed.length === 1) return allowed[0];
    if (method === "transplant" && allowed.includes("plant")) return "plant";
    return s?.pattern ?? "row";
  }

  function chooseBed(id: string | null) {
    const b = beds.find((x) => x.id === id);
    if (!b || draft?.bed_id === b.id) return;
    // 그 구획에서 다른 작물이 쓰고 남은 곳부터
    const used = others.filter((p) => p.bed_id === b.id).reduce((m, p) => Math.max(m, p.start_cm + (p.length_cm ?? bedLength(b))), 0);
    const start = used >= bedLength(b) ? 0 : used;
    const m = draft?.method ?? defaultMethod();
    setDraft({
      id: DRAFT,
      bed_id: b.id,
      crop_id: cropId,
      rows: rowsFor(b, m, s, Math.min(b.w_cm, b.h_cm) >= 70 ? 2 : 1),
      layout: draft?.layout ?? "parallel",
      method: m,
      start_cm: start,
      length_cm: start ? bedLength(b) - start : null,
      plant_count: plantCount,
      carried_from_planting_id: null,
    });
  }

  const plantings = useMemo(() => (draft ? [...others, draft] : others), [others, draft]);
  const tone = toneMap(plantings.map((p) => p.crop_id)).get(cropId)?.stroke ?? "#2f7d32";

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { error } = await supabase.rpc("place_planting", {
      p_planting_id: plantingId,
      p_bed_id: draft.bed_id,
      p_rows: draft.rows,
      p_layout: draft.layout,
      p_method: draft.method,
      p_start_cm: draft.start_cm,
      p_length_cm: draft.length_cm,
      p_plant_count: draft.plant_count,
    });
    if (error) {
      setBusy(false);
      return setError("자리를 저장하지 못했어요.");
    }
    // 면적이 정해졌으니 밑거름·웃거름 양을 다시 계산한다
    await regenerateTasks(supabase, plantingId).catch(() => undefined);
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{draft ? "숫자로 자리를 다듬고 저장하세요. 다른 두둑을 누르면 옮겨져요." : `${cropName}을(를) 심은 두둑을 눌러 고르세요.`}</p>
      <div className="rounded-2xl border border-line bg-white p-2">
        <FieldMap
          widthCm={widthCm}
          heightCm={heightCm}
          beds={beds}
          plantings={plantings}
          cropNames={cropNames}
          spacingOf={(id) => spacing[id] ?? null}
          markers={draft ? { [DRAFT]: "todo" } : {}}
          selectedBedId={draft?.bed_id ?? null}
          mode="plant"
          onSelectBed={chooseBed}
        />
      </div>
      {draft && bed && (
        <div className="rounded-2xl border border-line bg-white p-4">
          <PlantingPanel
            bed={bed}
            planting={draft}
            cropName={cropName}
            tone={tone}
            spacing={spacing[cropId] ?? null}
            sowing={s}
            editable
            warned={false}
            onSave={setDraft}
          />
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      <Button onClick={save} disabled={!draft || busy}>
        {busy ? "저장 중…" : "이 자리로 저장"}
      </Button>
    </div>
  );
}
