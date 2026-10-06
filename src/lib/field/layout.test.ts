import { describe, expect, it } from "vitest";
import { recommendSize, roundStep, snapMove, snapResize, type PlantSetup } from "./layout";

const setup = (over: Partial<PlantSetup>): PlantSetup => ({
  count: 8,
  rows: 1,
  layout: "parallel",
  method: "plant",
  lengthCm: 200,
  orientation: "horizontal",
  ...over,
});

describe("recommendSize", () => {
  it("배추 8포기 한 줄: 8 × 포기 간격 40cm, 폭은 줄간격 60cm", () => {
    expect(recommendSize(setup({}), 40, 60)).toEqual({ kind: "bed", w_cm: 320, h_cm: 60 });
  });

  it("두 줄이면 길이는 반, 폭은 두 배", () => {
    expect(recommendSize(setup({ rows: 2 }), 40, 60)).toEqual({ kind: "bed", w_cm: 160, h_cm: 120 });
  });

  it("세로로 놓으면 가로·세로가 바뀐다", () => {
    expect(recommendSize(setup({ orientation: "vertical" }), 40, 60)).toEqual({ kind: "bed", w_cm: 60, h_cm: 320 });
  });

  it("줄간격이 없으면 포기 간격을 쓰고, 10cm 단위로 올린다", () => {
    expect(recommendSize(setup({ count: 5 }), 25, null)).toEqual({ kind: "bed", w_cm: 130, h_cm: 30 });
  });

  it("포기가 아주 적어 긴 쪽이 짧아지면 네모 밭", () => {
    expect(recommendSize(setup({ count: 1 }), 40, 60)).toEqual({ kind: "plot", w_cm: 40, h_cm: 60 });
  });

  it("줄뿌림은 입력 길이 × 줄 수 × 줄간격", () => {
    expect(recommendSize(setup({ method: "row", rows: 3, lengthCm: 150 }), 5, 20)).toEqual({ kind: "bed", w_cm: 150, h_cm: 60 });
  });
});

describe("magnet snapping", () => {
  const field = { w: 500, h: 400 };
  const other = { x_cm: 100, y_cm: 100, w_cm: 80, h_cm: 300 };

  it("가까운 구획 가장자리에 붙는다 (고랑 없이 맞대기)", () => {
    // 오른쪽 가장자리 180에서 7cm 떨어진 곳에 놓으면 180에 붙는다
    expect(snapMove({ x_cm: 187, y_cm: 104, w_cm: 80, h_cm: 300 }, [other], field)).toMatchObject({ x_cm: 180, y_cm: 100 });
  });

  it("멀면 10cm 격자에 맞춘다", () => {
    expect(snapMove({ x_cm: 243, y_cm: 37, w_cm: 80, h_cm: 100 }, [other], field)).toMatchObject({ x_cm: 240, y_cm: 40 });
  });

  it("밭 밖으로 나가지 않고 끝에 붙는다", () => {
    expect(snapMove({ x_cm: 430, y_cm: 0, w_cm: 80, h_cm: 100 }, [], field)).toMatchObject({ x_cm: 420 });
  });

  it("크기 조절도 다른 구획 끝에 맞춘다", () => {
    expect(snapResize({ x_cm: 200, y_cm: 100, w_cm: 60, h_cm: 293 }, [other], field)).toMatchObject({ h_cm: 300 });
    expect(snapResize({ x_cm: 200, y_cm: 100, w_cm: 64, h_cm: 50 }, [other], field)).toMatchObject({ w_cm: 60, h_cm: 50 });
  });

  it("숫자 입력은 10cm 단위", () => {
    expect(roundStep(83)).toBe(80);
    expect(roundStep(3)).toBe(10);
  });
});
