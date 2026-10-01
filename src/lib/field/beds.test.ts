import { describe, expect, it } from "vitest";
import { autoPlantCount, autoRowCount, sowLines, plantPositions, segmentCells, segmentRect, type Bed, type BedPlanting } from "./beds";

const vertical: Bed = { id: "v", kind: "bed", x_cm: 0, y_cm: 200, w_cm: 100, h_cm: 300, label: null };
const horizontal: Bed = { id: "h", kind: "bed", x_cm: 0, y_cm: 100, w_cm: 300, h_cm: 50, label: null };
const plot: Bed = { id: "p", kind: "plot", x_cm: 200, y_cm: 0, w_cm: 100, h_cm: 100, label: null };
const bp = (o: Partial<BedPlanting>): BedPlanting => ({
  id: "x",
  bed_id: "v",
  crop_id: "c",
  rows: 1,
  start_cm: 0,
  length_cm: null,
  plant_count: null,
  layout: "parallel",
  method: "plant",
  carried_from_planting_id: null,
  ...o,
});

describe("bed geometry", () => {
  it("cuts segments along the long axis", () => {
    expect(segmentRect(vertical, bp({ start_cm: 100, length_cm: 50 }))).toEqual({ x0: 0, y0: 300, x1: 100, y1: 350 });
    expect(segmentRect(horizontal, bp({ start_cm: 100, length_cm: 100 }))).toEqual({ x0: 100, y0: 100, x1: 200, y1: 150 });
    expect(segmentRect(horizontal, bp({ start_cm: 250, length_cm: 500 }))).toEqual({ x0: 250, y0: 100, x1: 300, y1: 150 });
  });

  it("matches the DB cell rule (same cases as supabase/tests/p6_beds)", () => {
    const key = (cs: { x: number; y: number }[]) => cs.map((c) => `${c.x},${c.y}`).sort();
    expect(segmentCells(segmentRect(vertical, bp({})), 50)).toHaveLength(12);
    expect(key(segmentCells(segmentRect(horizontal, bp({ start_cm: 100, length_cm: 100 })), 50))).toEqual(["2,2", "3,2"]);
    expect(key(segmentCells(segmentRect(plot, bp({})), 50))).toEqual(["4,0", "4,1", "5,0", "5,1"]);
    // 칸보다 작은 구간은 중심 칸 하나
    expect(segmentCells({ x0: 10, y0: 10, x1: 30, y1: 30 }, 50)).toEqual([{ x: 0, y: 0 }]);
  });

  it("counts plants from rows and spacing", () => {
    expect(autoPlantCount(vertical, bp({ rows: 2 }), 25)).toBe(24);
    expect(autoPlantCount(plot, bp({}), 40)).toBe(4);
    expect(autoPlantCount(vertical, bp({}), null)).toBeNull();
    expect(autoPlantCount(vertical, bp({ rows: 2, method: "hill" }), 25)).toBe(24);
    expect(autoPlantCount(vertical, bp({ method: "row" }), 25)).toBeNull();
    expect(autoPlantCount(vertical, bp({ method: "broadcast" }), 25)).toBeNull();
  });

  it("derives drill-sowing rows from bed width and row spacing", () => {
    expect(autoRowCount(vertical, 30)).toBe(Math.floor(vertical.w_cm / 30));
    expect(autoRowCount(vertical, null)).toBeNull();
    expect(sowLines(vertical, bp({ rows: 3, method: "row" }))).toHaveLength(3);
  });

  it("lays plants out in rows inside the segment", () => {
    const pts = plantPositions(vertical, bp({ rows: 2 }), 6);
    expect(pts).toHaveLength(6);
    expect(new Set(pts.map((p) => p.x))).toEqual(new Set([25, 75]));
    expect(pts.every((p) => p.y > 200 && p.y < 500)).toBe(true);
    const five = plantPositions(plot, bp({}), 5);
    expect(five).toHaveLength(5);
    expect(five.every((p) => p.x > 200 && p.x < 300 && p.y > 0 && p.y < 100)).toBe(true);
  });

  it("offsets alternate rows by half a step when staggered", () => {
    const par = plantPositions(vertical, bp({ rows: 2 }), 6);
    const stg = plantPositions(vertical, bp({ rows: 2, layout: "staggered" }), 6);
    const ys = (pts: { x: number; y: number }[], x: number) => pts.filter((p) => p.x === x).map((p) => p.y);
    expect(ys(par, 25)).toEqual(ys(par, 75));
    const [l, r] = [ys(stg, 25), ys(stg, 75)];
    const step = l[1] - l[0];
    r.forEach((y, i) => expect(y - l[i]).toBeCloseTo(step / 2));
  });
});
