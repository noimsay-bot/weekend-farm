import { describe, expect, it } from "vitest";
import { extractWeeklySummaries } from "./weekly";

// 실제 주간농사정보 요약 형식을 줄인 예
const TEXT = [
  "목 차",
  "요 약",
  "분야",
  "농업",
  "정보",
  "• (기상) 기온은 평년보다 높겠음",
  "벼",
  "• (병해충) 이삭도열병, 잎집무늬마름병 등 적기 방제",
  "밭작물",
  "• (콩) 꼬투리가 노랗게 변할 때 수확",
  "• (고구마) 10월 상중순까지 수확",
  "채소",
  "• (가을 배추‧무) 아주심기 후 15일 간격으로 비료 주기",
  "* 생육 부진 포장은 요소 0.2%액을 잎에 뿌림",
  "• (딸기) 흰가루병 예방 철저",
  "과수",
  "• (배) 가을거름 주기",
  "제1장 농업정보",
  "• (배추) 본문 쪽 문장은 쓰지 않음",
].join("\n");

describe("weekly farm info", () => {
  it("picks summary items for field and vegetable crops", () => {
    const notes = extractWeeklySummaries(TEXT, [
      { id: "1", name: "배추" },
      { id: "2", name: "무" },
      { id: "3", name: "딸기" },
      { id: "4", name: "콩" },
      { id: "5", name: "배" },
      { id: "6", name: "상추" },
    ]);
    expect(notes).toEqual([
      {
        cropId: "1",
        cropName: "배추",
        pest: null,
        summary: "(가을 배추‧무) 아주심기 후 15일 간격으로 비료 주기 * 생육 부진 포장은 요소 0.2%액을 잎에 뿌림",
      },
      {
        cropId: "2",
        cropName: "무",
        pest: null,
        summary: "(가을 배추‧무) 아주심기 후 15일 간격으로 비료 주기 * 생육 부진 포장은 요소 0.2%액을 잎에 뿌림",
      },
      { cropId: "3", cropName: "딸기", pest: "흰가루병", summary: "(딸기) 흰가루병 예방 철저" },
      { cropId: "4", cropName: "콩", pest: null, summary: "(콩) 꼬투리가 노랗게 변할 때 수확" },
    ]);
  });

  it("returns nothing when there is no summary", () => {
    expect(extractWeeklySummaries("제1장 농업정보\n• (배추) 문장", [{ id: "1", name: "배추" }])).toEqual([]);
  });
});
