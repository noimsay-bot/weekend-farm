import { describe, expect, it } from "vitest";
import { addressTokens, geocode, rankByContext, type GeocodeResult } from "./geocode";

const r = (id: number, name: string): GeocodeResult => ({
  place_id: id,
  display_name: name,
  lat: "0",
  lon: "0",
});

const noWait = async () => {};

describe("addressTokens", () => {
  it("drops lot numbers", () => {
    expect(addressTokens("경기 김포시 고촌읍 풍곡리 산44-1")).toEqual([
      "경기",
      "김포시",
      "고촌읍",
      "풍곡리",
    ]);
    expect(addressTokens("파주시 탄현면 123번지")).toEqual(["파주시", "탄현면"]);
  });
});

describe("rankByContext", () => {
  it("keeps results matching the most context names", () => {
    const results = [
      r(1, "풍곡리, 김포시, 경기도, 10128, 대한민국"),
      r(2, "풍곡리, 삼척시, 강원특별자치도, 25955, 대한민국"),
    ];
    expect(rankByContext(results, ["경기", "김포시", "고촌읍"]).map((x) => x.place_id)).toEqual([1]);
  });

  it("drops results matching no context", () => {
    expect(rankByContext([r(2, "풍곡리, 삼척시")], ["김포시"])).toEqual([]);
  });
});

describe("geocode", () => {
  it("returns full-address results when found", async () => {
    const out = await geocode("파주시 탄현면", async () => [r(1, "탄현면, 파주시")], noWait);
    expect(out).toEqual({ results: [r(1, "탄현면, 파주시")], matchedName: null });
  });

  it("falls back to the smallest place name with context", async () => {
    // 실제 Nominatim 응답 형태를 흉내: 전체 조합은 실패, "풍곡리" 단독은 성공
    const db: Record<string, GeocodeResult[]> = {
      풍곡리: [r(1, "풍곡리, 김포시, 경기도, 대한민국"), r(2, "풍곡리, 삼척시, 강원특별자치도")],
    };
    const queries: string[] = [];
    const out = await geocode(
      "경기 김포시 고촌읍 풍곡리 산44-1",
      async (q) => {
        queries.push(q);
        return db[q] ?? [];
      },
      noWait,
    );
    expect(queries).toEqual(["경기 김포시 고촌읍 풍곡리", "풍곡리"]);
    expect(out.matchedName).toBe("풍곡리");
    expect(out.results.map((x) => x.place_id)).toEqual([1]);
  });

  it("returns empty when nothing matches", async () => {
    const out = await geocode("없는동 없는리", async () => [], noWait);
    expect(out).toEqual({ results: [], matchedName: null });
  });
});
