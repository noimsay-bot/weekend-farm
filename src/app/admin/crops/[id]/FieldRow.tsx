"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatFieldValue, type CropFieldDef } from "@/lib/crop-fields";

export type FieldSource = {
  field_name: string;
  extracted_value: string | null;
  source_text: string | null;
  source_url: string | null;
  approved: boolean;
  manual_input: boolean;
};

export function FieldRow({
  cropId,
  def,
  value,
  source,
}: {
  cropId: string;
  def: CropFieldDef;
  value: unknown;
  source: FieldSource | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(value === null || value === undefined ? "" : String(value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const state = source?.manual_input ? "수동 입력" : source?.approved ? "승인됨" : source ? "미확인" : "근거 없음";
  const done = Boolean(source?.approved || source?.manual_input);

  async function run(fn: () => PromiseLike<{ error: unknown }>) {
    setBusy(true);
    setError("");
    const { error } = await fn();
    setBusy(false);
    if (error) return setError("저장하지 못했어요. 값 형식을 확인하세요.");
    setEditing(false);
    router.refresh();
  }

  const approve = () => run(() => createClient().rpc("approve_crop_field", { p_crop_id: cropId, p_field: def.name }));
  const save = (v: string | null) =>
    run(() => createClient().rpc("set_crop_field", { p_crop_id: cropId, p_field: def.name, p_value: v }));

  return (
    <div className={`rounded-lg border bg-white p-3 text-sm ${done ? "border-neutral-200" : "border-amber-300"}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{def.label}</p>
          <p className="text-base">{formatFieldValue(def, value)}</p>
        </div>
        <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${done ? "bg-primary text-white" : "bg-amber-100 text-amber-800"}`}>
          {state}
        </span>
      </div>

      {source?.source_text && (
        <blockquote className="mt-2 border-l-2 border-neutral-300 pl-2 text-xs text-neutral-600">
          {source.source_text}
          {source.source_url && (
            <a href={source.source_url} target="_blank" rel="noreferrer" className="ml-1 text-primary underline">
              출처
            </a>
          )}
        </blockquote>
      )}

      {editing ? (
        <div className="mt-2 flex flex-col gap-2">
          <ValueInput def={def} value={input} onChange={setInput} />
          <div className="flex gap-2">
            <button className="h-10 flex-1 rounded bg-primary text-white" disabled={busy} onClick={() => save(input.trim() || null)}>
              저장
            </button>
            <button className="h-10 flex-1 rounded border" disabled={busy} onClick={() => save(null)}>
              해당 없음
            </button>
            <button className="h-10 rounded border px-3" disabled={busy} onClick={() => setEditing(false)}>
              취소
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          {source?.extracted_value !== null && source && !done && (
            <button className="h-10 flex-1 rounded bg-primary text-white" disabled={busy} onClick={approve}>
              추출값 승인
            </button>
          )}
          <button className="h-10 flex-1 rounded border" disabled={busy} onClick={() => setEditing(true)}>
            직접 입력
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function ValueInput({ def, value, onChange }: { def: CropFieldDef; value: string; onChange: (v: string) => void }) {
  const cls = "h-10 w-full rounded border border-neutral-300 px-2 text-base";
  if (def.kind === "enum" || def.kind === "bool") {
    const options = def.kind === "bool" ? [{ value: "true", label: "예" }, { value: "false", label: "아니오" }] : def.options!;
    return (
      <select className={cls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">선택</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      className={cls}
      inputMode={def.kind === "int" || def.kind === "number" ? "decimal" : "text"}
      placeholder={def.kind === "family" ? "예: 가지과" : def.unit}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
