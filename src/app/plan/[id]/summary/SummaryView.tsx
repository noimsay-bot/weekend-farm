"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatKDate } from "@/lib/dates";
import type { SeasonSummary } from "@/lib/summary/build";
import { generateSeasonSummaries } from "@/lib/summary/generate";
import { Button, ErrorText } from "@/components/ui";

export type SummaryRow = {
  id: string;
  plan_crop_id: string;
  summary: SeasonSummary;
  representative_photo_id: string | null;
  created_at: string;
  photos: { id: string; storage_path: string; date: string }[];
};

export function SummaryView({ planId, confirmed, allEnded, rows }: { planId: string; confirmed: boolean; allEnded: boolean; rows: SummaryRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [urls, setUrls] = useState<Record<string, string>>({});

  async function generate() {
    setBusy(true);
    setError("");
    try {
      await generateSeasonSummaries(createClient(), planId);
      router.refresh();
    } catch {
      setError("결산을 만들지 못했어요.");
    }
    setBusy(false);
  }

  // 작기 내 모든 식재가 끝났고 결산이 없으면 자동으로 만든다
  const autoGenerate = confirmed && allEnded && rows.length === 0;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (autoGenerate) void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerate]);

  useEffect(() => {
    const paths = rows.flatMap((r) => r.photos.map((p) => p.storage_path));
    if (!paths.length) return;
    createClient()
      .storage.from("work-photos")
      .createSignedUrls(paths, 3600)
      .then(({ data }) => setUrls(Object.fromEntries((data ?? []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]))));
  }, [rows]);

  async function pickPhoto(summaryId: string, photoId: string) {
    await createClient().from("season_summaries").update({ representative_photo_id: photoId }).eq("id", summaryId);
    router.refresh();
  }

  if (!confirmed) return <p className="text-sm">확정된 계획만 결산할 수 있어요.</p>;

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-xs text-neutral-500">
        {allEnded ? "모든 식재가 끝났어요." : "아직 재배 중인 식재가 있어요. 지금까지의 기록으로 결산할 수 있어요."} 수확량은 기록하지 않아 결산에도 없어요.
      </p>
      <ErrorText>{error}</ErrorText>
      <Button onClick={generate} disabled={busy} variant={rows.length ? "secondary" : "primary"}>
        {busy ? "만드는 중…" : rows.length ? "결산 다시 만들기" : "결산 만들기"}
      </Button>

      {rows.map((r) => {
        const s = r.summary;
        const rep = r.photos.find((p) => p.id === r.representative_photo_id);
        return (
          <section key={r.id} className="flex flex-col gap-2 rounded-lg bg-white p-3">
            <h2 className="text-base font-semibold">
              {s.crop}
              {s.isCompanion && " (사이작물)"}
            </h2>
            {rep && urls[rep.storage_path] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={urls[rep.storage_path]} alt="" className="h-40 w-full rounded object-cover" />
            )}
            {s.plantings.map((p) => (
              <p key={p.round}>
                {s.plantings.length > 1 && `${p.round}회차 · `}
                {p.date ? `${formatKDate(p.date)} ${p.method}` : "날짜 없음"}
                {p.variety && ` · ${p.variety}`}
              </p>
            ))}
            <p>
              추비 {s.topDressing.count}회{s.topDressing.dates.length > 0 && ` (${s.topDressing.dates.map(formatKDate).join(", ")})`}
            </p>
            <p>
              방제 {s.pestControl.count}회{s.pestControl.dates.length > 0 && ` (${s.pestControl.dates.map(formatKDate).join(", ")})`}
              {s.pestControl.ingredients.length > 0 && ` · 성분: ${s.pestControl.ingredients.join(", ")}`}
            </p>
            {s.pestNotes.length > 0 && (
              <div>
                <p className="text-xs font-medium text-neutral-500">병해충 메모</p>
                {s.pestNotes.map((n) => (
                  <p key={n.date + n.memo}>
                    {formatKDate(n.date)} {n.memo}
                  </p>
                ))}
              </div>
            )}
            <p>
              비 자동 기록 {s.rain.count}회 · 합계 {s.rain.totalMm}mm
            </p>
            {s.plannedVsActual.length > 0 && (
              <div>
                <p className="text-xs font-medium text-neutral-500">예정 대비 실제</p>
                {s.plannedVsActual.map((p) => (
                  <p key={p.title + p.planned}>
                    {p.title}: 예정 {formatKDate(p.planned)} → 실제 {formatKDate(p.actual)}
                    {p.diffDays !== 0 && ` (${p.diffDays > 0 ? "+" : ""}${p.diffDays}일)`}
                  </p>
                ))}
              </div>
            )}
            {r.photos.length > 0 && (
              <div>
                <p className="text-xs font-medium text-neutral-500">대표 사진 고르기</p>
                <div className="mt-1 flex gap-2 overflow-x-auto">
                  {r.photos.map((p) =>
                    urls[p.storage_path] ? (
                      <button key={p.id} onClick={() => pickPhoto(r.id, p.id)} className={`shrink-0 rounded ${p.id === r.representative_photo_id ? "ring-2 ring-primary" : ""}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={urls[p.storage_path]} alt="" className="h-16 w-16 rounded object-cover" />
                      </button>
                    ) : null,
                  )}
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
