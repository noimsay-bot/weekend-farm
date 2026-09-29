"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BADGE_LABEL, type Badge } from "@/lib/dashboard/badges";
import { addDays, formatKDate } from "@/lib/dates";
import { baseLines, productFor, topDressingLines } from "@/lib/fertilizer-text";
import { cellsToM2, formatPesticide } from "@/lib/units";
import type { DashboardData, DashPlanting } from "./load";

// 배지 상세 시트: 무엇을·왜, 어떻게, 근거. 완료 → 작업 기록, 미루기 → 예정일 조정.
export function BadgeSheet({
  data,
  planting,
  badges,
  onClose,
}: {
  data: DashboardData;
  planting: DashPlanting | null;
  badges: Badge[];
  onClose: () => void;
}) {
  const [open, setOpen] = useState<string>(badges[0].id);
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div className="mx-auto max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-background p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">{planting ? `${planting.cropName} 할 일` : "할 일"}</h2>
          <button className="text-sm text-neutral-500" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="flex flex-col gap-3">
          {badges.map((b) => (
            <BadgeDetail key={b.id} data={data} planting={planting} badge={b} expanded={open === b.id} onToggle={() => setOpen(b.id)} />
          ))}
        </div>
        {planting && (
          <Link href={`/history/${planting.planCropId}`} className="mt-4 block text-center text-sm text-primary underline">
            {planting.cropName} 히스토리 보기
          </Link>
        )}
      </div>
    </div>
  );
}

function BadgeDetail({
  data,
  planting,
  badge,
  expanded,
  onToggle,
}: {
  data: DashboardData;
  planting: DashPlanting | null;
  badge: Badge;
  expanded: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const d = (badge.detail ?? {}) as Record<string, unknown>;
  const area = planting ? cellsToM2(planting.cells.length, data.cellSizeM) : null;
  const how = howLines(data, planting, badge, area);

  async function run(fn: () => PromiseLike<{ error: unknown }>) {
    setBusy(true);
    setError("");
    const { error } = await fn();
    setBusy(false);
    if (error) return setError("처리하지 못했어요.");
    router.refresh();
  }

  const complete = () => run(() => createClient().rpc("complete_task", { p_task_id: badge.taskId, p_work_date: data.today }));
  const postpone = (date: string) => run(() => createClient().from("tasks").update({ adjusted_date: date }).eq("id", badge.taskId!));
  const watered = () =>
    run(async () => {
      const supabase = createClient();
      const { data: claims } = await supabase.auth.getClaims();
      const { data: log, error } = await supabase
        .from("work_logs")
        .insert({ farm_id: data.farmId, work_date: data.today, work_type: "watering", created_by: claims?.claims.sub })
        .select("id")
        .single();
      if (error || !log) return { error: error ?? new Error("insert failed") };
      return supabase.from("work_log_targets").insert({ work_log_id: log.id, plan_crop_id: d.planCropId as string });
    });

  return (
    <section className="rounded-lg bg-white p-3 text-sm">
      <button className="flex w-full items-center justify-between text-left" onClick={onToggle}>
        <span>
          <span className="block font-medium">{badge.title}</span>
          <span className="text-xs text-neutral-500">
            {BADGE_LABEL[badge.kind]}
            {badge.date && ` · ${formatKDate(badge.date)}`}
            {badge.state === "overdue" && <span className="ml-1 font-semibold text-orange-700">지연</span>}
          </span>
        </span>
        <span className="text-neutral-400">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="mt-2 flex flex-col gap-2">
          {typeof d.reason === "string" && <p className="text-neutral-700">{d.reason}</p>}
          {how.length > 0 && (
            <div className="rounded bg-neutral-50 p-2">
              <p className="mb-1 text-xs font-medium text-neutral-500">어떻게</p>
              {how.map((l) => (
                <p key={l}>{l}</p>
              ))}
            </div>
          )}
          {badge.kind === "prevention" && badge.taskId && (
            <p className="text-xs font-medium text-amber-900">사용 전 제품 라벨의 등록 작물과 사용법을 확인하세요</p>
          )}
          {typeof d.source_url === "string" && d.source_url && (
            <a href={d.source_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
              근거: 원문 보기
            </a>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}

          {badge.taskId && (
            <div className="flex flex-wrap gap-2">
              <button className="h-10 flex-1 rounded bg-primary text-white" disabled={busy} onClick={complete}>
                완료
              </button>
              <button className="h-10 flex-1 rounded border" disabled={busy} onClick={() => postpone(addDays(badge.date ?? data.today, 1))}>
                하루 미루기
              </button>
              <input
                type="date"
                className="h-10 rounded border px-2"
                defaultValue={badge.date ?? undefined}
                onChange={(e) => e.target.value && postpone(e.target.value)}
              />
              <Link href={`/log/new?date=${data.today}`} className="w-full text-center text-xs text-primary underline">
                사진과 함께 기록하기
              </Link>
            </div>
          )}
          {badge.kind === "watering" && typeof d.planCropId === "string" && (
            <button className="h-10 rounded bg-primary text-white" disabled={busy} onClick={watered}>
              물 줬어요
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function howLines(data: DashboardData, planting: DashPlanting | null, badge: Badge, area: number | null): string[] {
  const d = (badge.detail ?? {}) as Record<string, unknown>;
  if (!planting) return [];
  const ferts = data.fertilizers[planting.cropId] ?? [];

  if (badge.kind === "top_dressing") {
    const row = ferts.find((f) => f.stage === "top_dressing" && f.sequence === d.sequence);
    const product = productFor("top_dressing", data.products, data.productSettings);
    return row ? topDressingLines(row, product, planting.plantCount, area) : [];
  }
  if (badge.kind === "field_prep") {
    const row = ferts.find((f) => f.stage === "base");
    const lines = row ? baseLines(row, productFor("base", data.products, data.productSettings), area) : [];
    const rot = d.rotation as { note: string; checklist: string[] } | null | undefined;
    if (rot) lines.push(rot.note, ...rot.checklist.map((c) => `☐ ${c}`));
    return lines;
  }
  if (badge.kind === "prevention" && badge.taskId) {
    const pest = String(d.pest ?? "");
    const rows = (data.pests[planting.cropId] ?? []).filter((p) => !pest || p.pest_name.includes(pest) || pest.includes(p.pest_name));
    const lines = [`대상 병해충: ${pest}`];
    for (const r of rows.slice(0, 5)) {
      lines.push(
        `${r.ingredient_name} (작용기작 ${r.moa_code ?? "정보 없음"})` +
          (r.dilution_factor ? ` · ${formatPesticide(r.dilution_factor, r.formulation)}` : "") +
          (r.safe_days_before_harvest !== null ? ` · 수확 ${r.safe_days_before_harvest}일 전까지` : "") +
          (r.max_applications !== null ? `, ${r.max_applications}회 이내` : ""),
      );
    }
    const organic = rows.filter((r) => r.is_organic);
    if (organic.length) lines.push(`친환경 대안: ${organic.map((r) => r.ingredient_name).join(", ")}`);
    if (rows.length === 0 && Array.isArray(d.ingredients) && d.ingredients.length) lines.push(`권장 성분: ${(d.ingredients as string[]).join(", ")}`);
    return lines;
  }
  if (badge.kind === "pruning" && typeof d.method === "string") return [d.method];
  return [];
}
