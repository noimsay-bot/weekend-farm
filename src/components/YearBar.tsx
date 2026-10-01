// 한눈에 보기: 1~12월 막대 위에 작형별 파종·정식·수확 시기를 칠한다 (해를 넘기는 기간도 처리).
export type YearRange = {
  region: string;
  cropping_type: string;
  activity: "sow" | "transplant" | "harvest";
  start_month: number;
  start_day: number;
  end_month: number;
  end_day: number;
};

const COLOR = { sow: "#8d6e63", transplant: "#43a047", harvest: "#f9a825" } as const;
const LABEL = { sow: "파종", transplant: "정식", harvest: "수확" } as const;

// 1월 1일 = 0, 12월 말 = 12 (월 단위 좌표)
const pos = (m: number, d: number) => m - 1 + (d - 1) / 31;

function segments(r: YearRange): [number, number][] {
  const s = pos(r.start_month, r.start_day);
  const e = pos(r.end_month, r.end_day) + 1 / 31;
  return s <= e ? [[s, e]] : [[s, 12], [0, e]];
}

export function YearBar({ ranges, region }: { ranges: YearRange[]; region: string | null }) {
  const regional = ranges.filter((r) => r.region === region);
  const shown = regional.length ? regional : ranges;
  const rows = [...new Set(shown.map((r) => `${r.region}|${r.cropping_type}`))];
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-white p-3 text-xs">
      <div className="ml-16 grid grid-cols-12 text-center text-neutral-400">
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i}>{i + 1}</span>
        ))}
      </div>
      {rows.map((key) => {
        const [reg, type] = key.split("|");
        const items = shown.filter((r) => r.region === reg && r.cropping_type === type);
        return (
          <div key={key} className="flex items-center gap-1">
            <span className="w-16 shrink-0 truncate text-neutral-600">{type || reg}</span>
            <div className="relative h-5 flex-1 rounded bg-neutral-100">
              {items.flatMap((r) =>
                segments(r).map(([s, e], i) => (
                  <span
                    key={`${r.activity}-${i}`}
                    className="absolute top-0.5 bottom-0.5 rounded-sm"
                    style={{ left: `${(s / 12) * 100}%`, width: `${((e - s) / 12) * 100}%`, background: COLOR[r.activity] }}
                    title={`${LABEL[r.activity]} ${r.start_month}/${r.start_day}~${r.end_month}/${r.end_day}`}
                  />
                )),
              )}
            </div>
          </div>
        );
      })}
      <div className="ml-16 flex gap-3 text-neutral-600">
        {(Object.keys(COLOR) as (keyof typeof COLOR)[]).map((k) => (
          <span key={k} className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLOR[k] }} />
            {LABEL[k]}
          </span>
        ))}
        {regional.length === 0 && region && <span className="text-neutral-400">({region} 자료 없음)</span>}
      </div>
    </div>
  );
}
