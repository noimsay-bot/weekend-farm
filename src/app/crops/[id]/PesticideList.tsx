"use client";

import { useState } from "react";
import { formatPesticide } from "@/lib/units";

export type PestRow = {
  id: string;
  pest_name: string;
  ingredient_name: string;
  moa_code: string | null;
  formulation: string | null;
  dilution_factor: number | null;
  safe_days_before_harvest: number | null;
  max_applications: number | null;
  is_organic: boolean;
  source_url: string | null;
};

// 병해충별 성분명·작용기작·물 1L 기준 약량·안전사용기준. 친환경 필터.
export function PesticideList({ rows }: { rows: PestRow[] }) {
  const [organicOnly, setOrganicOnly] = useState(false);
  const list = organicOnly ? rows.filter((r) => r.is_organic) : rows;
  const byPest = new Map<string, PestRow[]>();
  for (const r of list) byPest.set(r.pest_name, [...(byPest.get(r.pest_name) ?? []), r]);

  return (
    <div className="flex flex-col gap-2 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={organicOnly} onChange={(e) => setOrganicOnly(e.target.checked)} />
        친환경만 보기
      </label>
      {byPest.size === 0 && <p className="text-neutral-500">{organicOnly ? "친환경 자료가 없어요." : "농약 자료가 없어요."}</p>}
      {[...byPest].map(([pest, items]) => (
        <details key={pest} className="rounded-lg bg-white p-3">
          <summary className="cursor-pointer font-medium">
            {pest} <span className="text-xs text-neutral-500">({items.length})</span>
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {items.map((r) => (
              <li key={r.id} className="border-t pt-2">
                <p className="font-medium">
                  {r.ingredient_name}
                  {r.is_organic && <span className="ml-1 rounded bg-green-100 px-1 text-xs text-green-800">친환경</span>}
                </p>
                <p className="text-xs text-neutral-600">작용기작 {r.moa_code ?? "정보 없음"}</p>
                {r.dilution_factor && <p>{formatPesticide(r.dilution_factor, r.formulation)}</p>}
                <p className="text-xs text-neutral-600">
                  안전사용: {r.safe_days_before_harvest !== null ? `수확 ${r.safe_days_before_harvest}일 전까지` : "시기 정보 없음"}
                  {r.max_applications !== null && `, ${r.max_applications}회 이내`}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
