"use client";

import { useState } from "react";
import Link from "next/link";

export type CropCard = { id: string; name: string; category: string | null; description: string | null };

export function CropIndex({ crops }: { crops: CropCard[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim();
  const shown = q ? crops.filter((c) => c.name.includes(q) || c.category?.includes(q)) : crops;
  const groups = new Map<string, CropCard[]>();
  for (const c of shown) groups.set(c.category ?? "기타", [...(groups.get(c.category ?? "기타") ?? []), c]);
  const order = [...groups.keys()].sort((a, b) => (a === "기타" ? 1 : b === "기타" ? -1 : a.localeCompare(b)));

  return (
    <div className="flex flex-col gap-4">
      <input
        className="h-12 rounded-lg border border-neutral-300 bg-white px-3 text-base"
        placeholder="작물 이름 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {crops.length === 0 && <p className="text-sm text-neutral-500">아직 승인된 작물이 없어요.</p>}
      {crops.length > 0 && shown.length === 0 && <p className="text-sm text-neutral-500">찾는 작물이 없어요.</p>}
      {order.map((cat) => (
        <section key={cat} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-neutral-600">{cat}</h2>
          <ul className="flex flex-col divide-y rounded-lg bg-white">
            {groups.get(cat)!.map((c) => (
              <li key={c.id}>
                <Link href={`/crops/${c.id}`} className="flex flex-col gap-0.5 px-4 py-3">
                  <span className="font-medium">{c.name}</span>
                  {c.description && <span className="line-clamp-2 text-xs text-neutral-500">{c.description}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
