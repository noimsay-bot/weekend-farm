import { describe, expect, it } from "vitest";
import { toKmaGrid } from "./grid";
import { distanceKm, nearest, regionOf, WARNING_OFFICES } from "./stations";

describe("KMA grid", () => {
  it("matches known grid points", () => {
    // 기상청 격자 예: 서울 시청 부근 (60, 127), 부산 (98, 76), 제주시 (53, 38)
    expect(toKmaGrid(37.5665, 126.978)).toEqual({ nx: 60, ny: 127 });
    expect(toKmaGrid(35.1796, 129.0756)).toEqual({ nx: 98, ny: 76 });
    expect(toKmaGrid(33.4996, 126.5312)).toEqual({ nx: 53, ny: 38 });
  });
});

describe("stations", () => {
  it("picks nearest ASOS station", () => {
    // 김포 고촌읍 풍곡리 부근
    const s = nearest(37.6, 126.77);
    expect(["서울", "인천", "강화", "파주"]).toContain(s.name);
    expect(s.km).toBeLessThan(25);
  });

  it("picks warning office", () => {
    expect(nearest(37.6, 126.77, WARNING_OFFICES).id).toBe("109");
    expect(nearest(35.1, 129.0, WARNING_OFFICES).id).toBe("159");
  });

  it("distance is sane", () => {
    expect(distanceKm(37.5714, 126.9658, 35.1047, 129.032)).toBeGreaterThan(300);
  });

  it("region rule", () => {
    expect(regionOf(37.6, 126.77)).toBe("중부");
    expect(regionOf(35.1, 129.0)).toBe("남부");
    expect(regionOf(33.5, 126.5)).toBe("제주");
  });
});
