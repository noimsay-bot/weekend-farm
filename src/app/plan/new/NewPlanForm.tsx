"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SEASON_LABEL, seasonLabel, type PlanSeason } from "@/lib/season";
import { Button, ErrorText } from "@/components/ui";

export type CarryCandidate = {
  planting_id: string;
  crop_id: string;
  crop_name: string;
  season: "overwinter" | "perennial";
  overwinter_default: "keep" | "choose" | null;
  cells: { x: number; y: number }[];
};

type Plan = { id: string; year: number; season: PlanSeason; status: string };

export function NewPlanForm({
  farmId,
  initialYear,
  initialSeason,
  plans,
  candidates,
}: {
  farmId: string;
  initialYear: number;
  initialSeason: PlanSeason;
  plans: Plan[];
  candidates: CarryCandidate[];
}) {
  const router = useRouter();
  const [year, setYear] = useState(initialYear);
  const [season, setSeason] = useState<PlanSeason>(initialSeason);
  const [copyFrom, setCopyFrom] = useState("");
  // 기본값: 작물의 월동 점유 기본값이 '유지'면 선택됨
  const [keep, setKeep] = useState<Set<string>>(
    new Set(candidates.filter((c) => c.season === "overwinter" && c.overwinter_default === "keep").map((c) => c.planting_id)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const existing = plans.find((p) => p.year === year && p.season === season);
  // 월동 이월 선택은 봄 계획에만. 후보는 초기 연도 기준으로 불러왔으므로 연도가 바뀌면 숨긴다.
  const showCarry = season === "spring" && year === initialYear;
  const overwinter = candidates.filter((c) => c.season === "overwinter");
  const perennial = candidates.filter((c) => c.season === "perennial");

  function toggle(id: string) {
    const next = new Set(keep);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setKeep(next);
  }

  async function create() {
    setBusy(true);
    setError("");
    const { data, error } = await createClient().rpc("create_plan", {
      p_farm_id: farmId,
      p_year: year,
      p_season: season,
      p_copy_from: copyFrom || null,
      p_keep_plantings: showCarry ? [...keep] : [],
    });
    if (error || typeof data !== "string") {
      setBusy(false);
      return setError("계획을 만들지 못했어요.");
    }
    router.replace(`/plan/${data}`);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">연도</span>
          <input
            type="number"
            className="h-12 rounded-lg border border-neutral-300 bg-white px-3 text-base"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">작기</span>
          <select
            className="h-12 rounded-lg border border-neutral-300 bg-white px-3 text-base"
            value={season}
            onChange={(e) => setSeason(e.target.value as PlanSeason)}
          >
            {(Object.keys(SEASON_LABEL) as PlanSeason[]).map((s) => (
              <option key={s} value={s}>
                {SEASON_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {existing ? (
        <Button onClick={() => router.push(`/plan/${existing.id}`)}>이미 있는 {seasonLabel(existing)} 계획 열기</Button>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">이전 계획 복사 (선택)</span>
            <select
              className="h-12 rounded-lg border border-neutral-300 bg-white px-3 text-base"
              value={copyFrom}
              onChange={(e) => setCopyFrom(e.target.value)}
            >
              <option value="">빈 밭에서 시작</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {seasonLabel(p)}
                </option>
              ))}
            </select>
          </label>

          {showCarry && overwinter.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="font-semibold">월동 작물 칸</h2>
              <p className="text-xs text-neutral-500">
                &lsquo;점유 유지&rsquo;한 칸은 봄 계획에서 잠기고, 수확 기록을 입력하면 풀려요.
              </p>
              {overwinter.map((c) => (
                <div key={c.planting_id} className="flex items-center justify-between rounded-lg bg-white p-3 text-sm">
                  <span>
                    {c.crop_name} · {c.cells.length}칸
                  </span>
                  <div className="flex overflow-hidden rounded border border-primary text-xs">
                    <button
                      className={`px-3 py-2 ${keep.has(c.planting_id) ? "bg-primary text-white" : "text-primary"}`}
                      onClick={() => !keep.has(c.planting_id) && toggle(c.planting_id)}
                    >
                      점유 유지
                    </button>
                    <button
                      className={`px-3 py-2 ${!keep.has(c.planting_id) ? "bg-primary text-white" : "text-primary"}`}
                      onClick={() => keep.has(c.planting_id) && toggle(c.planting_id)}
                    >
                      수확 후 비움
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}

          {perennial.length > 0 && (
            <p className="rounded-lg bg-white p-3 text-xs text-neutral-600">
              여러해살이 {perennial.map((c) => c.crop_name).join(", ")} 칸은 식재를 종료하기 전까지 항상 점유 유지로 넘어가요.
            </p>
          )}

          <ErrorText>{error}</ErrorText>
          <Button onClick={create} disabled={busy}>
            {busy ? "만드는 중…" : `${seasonLabel({ year, season })} 계획 만들기`}
          </Button>
        </>
      )}
    </div>
  );
}
