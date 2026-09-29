import { describe, expect, it } from "vitest";
import { companionHits, companionIndex, goodCompanionsOf, type Companion } from "./companions";

const pair = (a: string, b: string, relation: "good" | "bad"): Companion => ({
  crop_a_id: a < b ? a : b,
  crop_b_id: a < b ? b : a,
  relation,
  reason: `${a}-${b}`,
  source_text: null,
  source_url: null,
});

const list = [pair("tomato", "basil", "good"), pair("tomato", "potato", "bad")];
const index = companionIndex(list);

describe("companions", () => {
  it("lists good companions for a crop", () => {
    expect(goodCompanionsOf("tomato", list)).toEqual(["basil"]);
    expect(goodCompanionsOf("basil", list)).toEqual(["tomato"]);
  });

  it("finds diagonal neighbors once per pair", () => {
    const hits = companionHits(
      [
        { x: 0, y: 0, crop_id: "tomato", companion_crop_id: null },
        { x: 1, y: 1, crop_id: "potato", companion_crop_id: null },
      ],
      index,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].companion.relation).toBe("bad");
  });

  it("checks main and companion in the same cell and neighbor companions", () => {
    const hits = companionHits(
      [
        { x: 0, y: 0, crop_id: "tomato", companion_crop_id: "basil" },
        { x: 2, y: 0, crop_id: "lettuce", companion_crop_id: "potato" },
        { x: 1, y: 0, crop_id: "tomato", companion_crop_id: null },
      ],
      index,
    );
    expect(hits.filter((h) => h.sameCell).map((h) => h.companion.relation)).toEqual(["good"]);
    // (1,0) 토마토 ↔ (2,0)의 사이작물 감자: bad
    expect(hits.some((h) => !h.sameCell && h.companion.relation === "bad")).toBe(true);
  });

  it("ignores cells not touching", () => {
    const hits = companionHits(
      [
        { x: 0, y: 0, crop_id: "tomato", companion_crop_id: null },
        { x: 2, y: 0, crop_id: "potato", companion_crop_id: null },
      ],
      index,
    );
    expect(hits).toEqual([]);
  });
});
