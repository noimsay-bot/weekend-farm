import { describe, expect, it } from "vitest";
import { parseAlertTitle, parsePcp } from "./kma";

describe("kma parsing", () => {
  it("parses precipitation text", () => {
    expect(parsePcp("강수없음")).toBe(0);
    expect(parsePcp("1mm 미만")).toBe(0.5);
    expect(parsePcp("3.0mm")).toBe(3);
    expect(parsePcp("30.0~50.0mm")).toBe(30);
    expect(parsePcp("50.0mm 이상")).toBe(50);
  });

  it("parses warning titles", () => {
    expect(parseAlertTitle("[특보] 제05-3호 : 2026.07.10.14:00 / 호우주의보 발표(*)")).toEqual([
      { type: "호우", level: "주의보", action: "발표" },
    ]);
    expect(parseAlertTitle("[특보] 제08-1호 : 2026.08.02.11:00 / 폭염경보 변경, 강풍주의보 해제")).toEqual([
      { type: "폭염", level: "경보", action: "변경" },
      { type: "강풍", level: "주의보", action: "해제" },
    ]);
  });
});
