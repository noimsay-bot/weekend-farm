"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatKDate } from "@/lib/dates";
import { lastDoneSummary } from "@/lib/dashboard/history";
import { WORK_TYPE_LABEL, type WorkType } from "@/lib/work-types";

export type HistoryLog = {
  id: string;
  work_date: string;
  work_type: WorkType;
  memo: string | null;
  rain_mm: number | null;
  is_auto: boolean;
  created_by: string | null;
  work_log_photos: { storage_path: string }[];
};

export function HistoryTimeline({ logs, today, userId }: { logs: HistoryLog[]; today: string; userId: string }) {
  const [filter, setFilter] = useState<WorkType | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const types = useMemo(() => [...new Set(logs.map((l) => l.work_type))], [logs]);
  const shown = filter ? logs.filter((l) => l.work_type === filter || (filter === "watering" && l.work_type === "rain")) : logs;

  useEffect(() => {
    const paths = logs.flatMap((l) => l.work_log_photos.map((p) => p.storage_path));
    if (!paths.length) return;
    createClient()
      .storage.from("work-photos")
      .createSignedUrls(paths, 3600)
      .then(({ data }) => setUrls(Object.fromEntries((data ?? []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]))));
  }, [logs]);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">히스토리</h2>
      {logs.length > 0 && <p className="text-xs text-neutral-600">{lastDoneSummary(logs, today)}</p>}
      <div className="flex gap-2 overflow-x-auto pb-1 text-xs">
        <button className={`shrink-0 rounded-full px-3 py-1 ${filter === null ? "bg-primary text-white" : "border bg-white"}`} onClick={() => setFilter(null)}>
          전체
        </button>
        {types
          .filter((t) => t !== "rain")
          .map((t) => (
            <button key={t} className={`shrink-0 rounded-full px-3 py-1 ${filter === t ? "bg-primary text-white" : "border bg-white"}`} onClick={() => setFilter(t)}>
              {WORK_TYPE_LABEL[t]}
            </button>
          ))}
      </div>
      {shown.length === 0 && <p className="text-sm text-neutral-500">기록이 없어요.</p>}
      <ol className="flex flex-col gap-2">
        {shown.map((l) => (
          <li key={l.id} className={`rounded-lg bg-white p-3 text-sm ${l.work_type === "rain" ? "border-l-4 border-sky-500" : ""}`}>
            <p className="font-medium">
              {formatKDate(l.work_date)} · {l.work_type === "rain" ? `비 ${l.rain_mm}mm` : WORK_TYPE_LABEL[l.work_type]}
            </p>
            {l.memo && <p className="text-neutral-700">{l.memo}</p>}
            <p className="text-xs text-neutral-500">{l.is_auto ? "자동 기록" : l.created_by === userId ? "내가 기록" : "함께하는 멤버가 기록"}</p>
            {l.work_log_photos.length > 0 && (
              <div className="mt-2 flex gap-2 overflow-x-auto">
                {l.work_log_photos.map((p) =>
                  urls[p.storage_path] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={p.storage_path} src={urls[p.storage_path]} alt="" className="h-16 w-16 shrink-0 rounded object-cover" />
                  ) : null,
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
