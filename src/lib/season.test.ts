import { describe, expect, it } from "vitest";
import { nextSeason, seasonOf, todayKst } from "./season";

describe("season", () => {
  it("uses KST for today", () => {
    // UTC 2026-09-29 16:00 = KST 2026-09-30 01:00
    expect(todayKst(new Date("2026-09-29T16:00:00Z"))).toBe("2026-09-30");
  });

  it("maps dates to seasons", () => {
    expect(seasonOf("2026-03-01")).toEqual({ year: 2026, season: "spring" });
    expect(seasonOf("2026-08-31")).toEqual({ year: 2026, season: "spring" });
    expect(seasonOf("2026-09-30")).toEqual({ year: 2026, season: "autumn" });
    expect(seasonOf("2026-12-10")).toEqual({ year: 2026, season: "overwinter" });
    expect(seasonOf("2027-02-10")).toEqual({ year: 2026, season: "overwinter" });
  });

  it("next season wraps to next spring", () => {
    expect(nextSeason({ year: 2026, season: "autumn" })).toEqual({ year: 2026, season: "overwinter" });
    expect(nextSeason({ year: 2026, season: "overwinter" })).toEqual({ year: 2027, season: "spring" });
  });
});
