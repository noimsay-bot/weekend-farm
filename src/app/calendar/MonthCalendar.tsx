"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { addDays, formatKDate } from "@/lib/dates";
import { exceedsTolerance } from "@/lib/schedule";
import { WORK_TYPE_LABEL, type WorkType } from "@/lib/work-types";

export type CalTask = {
  id: string;
  task_type: WorkType;
  title: string;
  calculated_date: string;
  adjusted_date: string | null;
  status: "pending" | "done";
  details: { reason?: string };
  planting_id: string | null;
  plantings: { crops: { schedule_tolerance_days: number | null } } | null;
};

export type CalLog = {
  id: string;
  work_date: string;
  work_type: WorkType;
  memo: string | null;
  rain_mm: number | null;
  is_auto: boolean;
  created_by: string | null;
  work_log_targets: { plan_crops: { crops: { name: string } } }[];
  work_log_photos: { id: string; storage_path: string }[];
};

const dueDate = (t: CalTask) => t.adjusted_date ?? t.calculated_date;

export function MonthCalendar({
  month,
  today,
  userId,
  tasks,
  logs,
}: {
  month: string;
  today: string;
  userId: string;
  tasks: CalTask[];
  logs: CalLog[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(today.startsWith(month) ? today : `${month}-01`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const first = `${month}-01`;
  const startWeekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  const daysInMonth = Number(addDays(addDays(first, 31).slice(0, 7) + "-01", -1).slice(8));
  const prevMonth = addDays(first, -1).slice(0, 7);
  const nextMonth = addDays(first, 32).slice(0, 7);

  const byDay = useMemo(() => {
    const m = new Map<string, { tasks: CalTask[]; logs: CalLog[] }>();
    const get = (d: string) => m.get(d) ?? (m.set(d, { tasks: [], logs: [] }), m.get(d)!);
    for (const t of tasks) get(dueDate(t)).tasks.push(t);
    for (const l of logs) get(l.work_date).logs.push(l);
    return m;
  }, [tasks, logs]);

  const day = byDay.get(selected) ?? { tasks: [], logs: [] };

  async function run(fn: () => PromiseLike<{ error: unknown }>) {
    setBusy(true);
    setError("");
    const { error } = await fn();
    setBusy(false);
    if (error) return setError("처리하지 못했어요.");
    router.refresh();
  }

  const complete = (t: CalTask) => run(() => createClient().rpc("complete_task", { p_task_id: t.id, p_work_date: today }));
  const adjust = (t: CalTask, date: string) => run(() => createClient().from("tasks").update({ adjusted_date: date }).eq("id", t.id));
  const skip = (t: CalTask) => run(() => createClient().from("tasks").update({ status: "cancelled" }).eq("id", t.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Link href={`/calendar?m=${prevMonth}`} className="px-3 py-2 text-primary">
          ◀
        </Link>
        <span className="font-semibold">
          {Number(month.slice(0, 4))}년 {Number(month.slice(5))}월
        </span>
        <Link href={`/calendar?m=${nextMonth}`} className="px-3 py-2 text-primary">
          ▶
        </Link>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
          <span key={d} className="text-neutral-500">
            {d}
          </span>
        ))}
        {Array.from({ length: startWeekday }, (_, i) => (
          <span key={`e${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const d = `${month}-${String(i + 1).padStart(2, "0")}`;
          const info = byDay.get(d);
          const pending = info?.tasks.filter((t) => t.status === "pending") ?? [];
          const late = pending.some(() => d < today);
          return (
            <button
              key={d}
              onClick={() => setSelected(d)}
              className={`flex h-12 flex-col items-center justify-start rounded pt-1 ${
                d === selected ? "bg-primary text-white" : d === today ? "border border-primary bg-white" : "bg-white"
              }`}
            >
              <span>{i + 1}</span>
              <span className="flex gap-0.5">
                {pending.length > 0 && <span className={`h-1.5 w-1.5 rounded-full ${late ? "bg-red-500" : "bg-amber-500"}`} />}
                {(info?.logs.length ?? 0) > 0 && <span className="h-1.5 w-1.5 rounded-full bg-green-600" />}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-neutral-500">● 주황: 예정 · 빨강: 지연 · 초록: 기록</p>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{formatKDate(selected)}</h2>
          <Link href={`/log/new?date=${selected}`} className="text-sm text-primary">
            + 기록하기
          </Link>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}

        {day.tasks.map((t) => {
          const tolerance = t.plantings?.crops.schedule_tolerance_days ?? null;
          const moved = t.adjusted_date && t.adjusted_date !== t.calculated_date;
          const warn = t.adjusted_date ? exceedsTolerance(t.calculated_date, t.adjusted_date, tolerance) : false;
          return (
            <div key={t.id} className={`rounded-lg p-3 text-sm ${t.status === "done" ? "bg-neutral-100 text-neutral-500" : "bg-white"}`}>
              <p className="font-medium">
                {t.status === "done" ? "✓ " : ""}
                {t.title}
              </p>
              {t.details?.reason && <p className="text-xs text-neutral-600">{t.details.reason}</p>}
              <p className="text-xs text-neutral-500">
                추천일 {formatKDate(t.calculated_date)}
                {moved && ` → 조정 ${formatKDate(t.adjusted_date!)}`}
                {dueDate(t) < today && t.status === "pending" && <span className="ml-1 font-semibold text-red-600">지연</span>}
              </p>
              {warn && <p className="text-xs text-amber-700">⚠ 허용 오차({tolerance}일)를 넘겨 조정했어요.</p>}
              {t.status === "pending" && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button className="h-9 rounded bg-primary px-3 text-white" disabled={busy} onClick={() => complete(t)}>
                    완료
                  </button>
                  <button className="h-9 rounded border px-3" disabled={busy} onClick={() => adjust(t, addDays(dueDate(t), -1))}>
                    하루 당기기
                  </button>
                  <button className="h-9 rounded border px-3" disabled={busy} onClick={() => adjust(t, addDays(dueDate(t), 1))}>
                    하루 미루기
                  </button>
                  <input
                    type="date"
                    className="h-9 rounded border px-2"
                    value={dueDate(t)}
                    onChange={(e) => e.target.value && adjust(t, e.target.value)}
                  />
                  <button className="h-9 rounded border px-3 text-neutral-500" disabled={busy} onClick={() => skip(t)}>
                    건너뛰기
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {day.logs.map((l) => (
          <LogCard key={l.id} log={l} mine={l.created_by === userId} onDeleted={() => router.refresh()} />
        ))}

        {day.tasks.length === 0 && day.logs.length === 0 && <p className="text-sm text-neutral-500">이 날은 예정 작업과 기록이 없어요.</p>}
      </section>
    </div>
  );
}

function LogCard({ log, mine, onDeleted }: { log: CalLog; mine: boolean; onDeleted: () => void }) {
  const [urls, setUrls] = useState<string[]>([]);
  const crops = log.work_log_targets.map((t) => t.plan_crops.crops.name);

  useEffect(() => {
    if (!log.work_log_photos.length) return;
    createClient()
      .storage.from("work-photos")
      .createSignedUrls(
        log.work_log_photos.map((p) => p.storage_path),
        3600,
      )
      .then(({ data }) => setUrls((data ?? []).map((d) => d.signedUrl).filter(Boolean) as string[]));
  }, [log.work_log_photos]);

  async function remove() {
    if (!window.confirm("이 기록을 지울까요?")) return;
    await createClient().from("work_logs").delete().eq("id", log.id);
    onDeleted();
  }

  return (
    <div className="rounded-lg border-l-4 border-green-600 bg-white p-3 text-sm">
      <p className="font-medium">
        {log.work_type === "rain" ? `비 ${log.rain_mm}mm` : WORK_TYPE_LABEL[log.work_type]}
        {crops.length > 0 && <span className="font-normal text-neutral-600"> · {crops.join(", ")}</span>}
      </p>
      {log.memo && <p className="text-neutral-700">{log.memo}</p>}
      <p className="text-xs text-neutral-500">{log.is_auto ? "자동 기록" : mine ? "내가 기록" : "함께하는 멤버가 기록"}</p>
      {urls.length > 0 && (
        <div className="mt-2 flex gap-2 overflow-x-auto">
          {urls.map((u) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={u} src={u} alt="" className="h-20 w-20 shrink-0 rounded object-cover" />
          ))}
        </div>
      )}
      {(mine || log.is_auto) && (
        <button className="mt-1 text-xs text-neutral-500 underline" onClick={remove}>
          삭제
        </button>
      )}
    </div>
  );
}
