"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { productFor, type ProductRow } from "@/lib/fertilizer-text";
import { Button, ErrorText } from "@/components/ui";

const USAGE = { base: "밑거름 (밭만들기)", top_dressing: "웃거름·추비" } as const;

export function FertilizerSettings({
  farmId,
  products,
  settings,
}: {
  farmId: string;
  products: ProductRow[];
  settings: { usage: string; product_id: string }[];
}) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", n: "", p: "", k: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function choose(usage: "base" | "top_dressing", productId: string) {
    await createClient().from("farm_fertilizer_settings").upsert({ farm_id: farmId, usage, product_id: productId }, { onConflict: "farm_id,usage" });
    router.refresh();
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await createClient()
      .from("fertilizer_products")
      .insert({ farm_id: farmId, name: form.name.trim(), n_pct: Number(form.n), p_pct: Number(form.p), k_pct: Number(form.k) });
    setBusy(false);
    if (error) return setError("추가하지 못했어요. 성분비는 0~100 사이 숫자로 입력하세요.");
    setForm({ name: "", n: "", p: "", k: "" });
    router.refresh();
  }

  async function remove(id: string) {
    if (!window.confirm("이 제품을 지울까요?")) return;
    await createClient().from("fertilizer_products").delete().eq("id", id);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5 text-sm">
      <p className="text-xs text-neutral-500">
        농사로 처방의 질소·인산·칼리 성분량을 고른 제품의 양으로 바꿔 보여줘요. 질소 기준으로 계산하고 인산·칼리 과부족은 한 줄로 알려드려요.
      </p>
      {(Object.keys(USAGE) as ("base" | "top_dressing")[]).map((usage) => (
        <label key={usage} className="flex flex-col gap-1">
          <span className="font-medium">{USAGE[usage]}에 쓰는 비료</span>
          <select
            className="h-11 rounded border border-neutral-300 bg-white px-2 text-base"
            value={productFor(usage, products, settings)?.id ?? ""}
            onChange={(e) => choose(usage, e.target.value)}
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({Number(p.n_pct)}-{Number(p.p_pct)}-{Number(p.k_pct)})
              </option>
            ))}
          </select>
        </label>
      ))}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">제품 목록</h2>
        <ul className="flex flex-col divide-y rounded-lg bg-white">
          {products.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-3 py-2">
              <span>
                {p.name} · N {Number(p.n_pct)}% · P {Number(p.p_pct)}% · K {Number(p.k_pct)}%
                {p.farm_id === null && <span className="ml-1 text-xs text-neutral-500">기본</span>}
              </span>
              {p.farm_id && (
                <button className="text-xs text-neutral-500 underline" onClick={() => remove(p.id)}>
                  삭제
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-neutral-500">기본 제품 성분비는 제품 라벨 기준이에요. 내 제품이 다르면 라벨대로 새로 등록하세요.</p>
      </section>

      <form onSubmit={add} className="flex flex-col gap-2 rounded-lg bg-white p-3">
        <h2 className="font-semibold">내 비료 등록</h2>
        <input className="h-10 rounded border px-2" placeholder="제품 이름" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <div className="grid grid-cols-3 gap-2">
          {(["n", "p", "k"] as const).map((k) => (
            <input
              key={k}
              className="h-10 rounded border px-2"
              inputMode="decimal"
              placeholder={`${k.toUpperCase()} %`}
              required
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
            />
          ))}
        </div>
        <ErrorText>{error}</ErrorText>
        <Button disabled={busy}>등록</Button>
      </form>
    </div>
  );
}
