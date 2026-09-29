import { describe, expect, it } from "vitest";
import { lastDoneSummary } from "./history";

describe("lastDoneSummary", () => {
  it("rain counts as watering and is marked", () => {
    expect(
      lastDoneSummary(
        [
          { work_date: "2026-09-27", work_type: "rain" },
          { work_date: "2026-09-25", work_type: "watering" },
          { work_date: "2026-09-18", work_type: "top_dressing" },
        ],
        "2026-09-30",
      ),
    ).toBe("마지막 물주기 3일 전(비) · 마지막 추비 12일 전");
  });

  it("empty when no logs", () => {
    expect(lastDoneSummary([], "2026-09-30")).toBe("");
  });
});
