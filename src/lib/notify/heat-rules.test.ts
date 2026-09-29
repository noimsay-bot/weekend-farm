import { describe, expect, it } from "vitest";
import { heatExpected, heatRecommendations, type HeatCandidate } from "./heat-rules";

const summer = { start_month: 6, start_day: 1, end_month: 8, end_day: 15 };
const cand = (over: Partial<HeatCandidate>): HeatCandidate => ({
  id: "x",
  name: "공심채",
  family_id: "메꽃과",
  rotation_risk: "low",
  rest_seasons: null,
  sowWindows: [summer],
  ...over,
});

describe("heat", () => {
  it("expects heat from warning or forecast max ≥ 33", () => {
    expect(heatExpected([], [{ alert_type: "폭염", action: "발표" }], "2026-07-20")).toBe(true);
    expect(heatExpected([{ date: "2026-07-21", minC: 25, maxC: 33, pop: 0, pcpMm: 0 }], [], "2026-07-20")).toBe(true);
    expect(heatExpected([{ date: "2026-07-21", minC: 25, maxC: 31, pop: 0, pcpMm: 0 }], [], "2026-07-20")).toBe(false);
  });

  it("recommends only crops in sowing window without rotation conflict", () => {
    const list = [
      cand({ id: "a", name: "공심채" }),
      cand({ id: "b", name: "오크라", family_id: "아욱과", rotation_risk: "high", rest_seasons: 1 }),
      cand({ id: "c", name: "늦은작물", sowWindows: [{ start_month: 9, start_day: 1, end_month: 9, end_day: 30 }] }),
    ];
    const history = [new Set(["국화과"]), new Set(["아욱과"])]; // 직전 작기에 아욱과
    expect(heatRecommendations(list, history, "2026-07-20").map((c) => c.name)).toEqual(["공심채"]);
    expect(heatRecommendations(list, [new Set(["국화과"])], "2026-07-20").map((c) => c.name)).toEqual(["공심채", "오크라"]);
  });
});
