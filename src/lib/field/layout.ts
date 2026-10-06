// 작물부터 고르는 밭 배치: 몇 포기를 어떻게 심을지로 추천 구획 크기를 계산하고,
// 구획을 끌 때 10cm 격자와 다른 구획·밭 가장자리에 자석처럼 붙인다. 좌표는 cm.
import type { RowLayout, SowPattern } from "./beds";

export const STEP_CM = 10;
// 자료에 줄간격이 없을 때 쓰는 값 (BedPlanEditor FALLBACK_ROW_SPACING과 같음)
export const FALLBACK_ROW_SPACING_CM = 20;

const up10 = (v: number) => Math.max(STEP_CM * 2, Math.ceil(v / STEP_CM) * STEP_CM);

export type PlantSetup = {
  count: number; // 포기 수 (모종 심기·점뿌림)
  rows: number; // 줄 수
  layout: RowLayout;
  method: SowPattern;
  lengthCm: number; // 줄뿌림·흩어뿌림 구간 길이
  orientation: "horizontal" | "vertical";
};

export type Size = { kind: "bed" | "plot"; w_cm: number; h_cm: number };

// 추천 구획 크기
// - 모종 심기·점뿌림: 긴 쪽 = 줄당 포기 수 × 포기 간격, 짧은 쪽 = 줄 수 × 줄간격(없으면 포기 간격)
// - 줄뿌림: 긴 쪽 = 입력한 길이, 짧은 쪽 = 줄 수 × 줄간격
// - 흩어뿌림: 입력한 길이의 정사각형에 가깝게
// 긴 쪽이 짧은 쪽보다 짧아지면(포기가 아주 적을 때) 네모 밭으로 만든다.
export function recommendSize(s: PlantSetup, plantSpacingCm: number | null, rowSpacingCm: number | null): Size {
  const across1 = rowSpacingCm ?? plantSpacingCm ?? FALLBACK_ROW_SPACING_CM;
  let along: number;
  let across: number;
  if (s.method === "broadcast") {
    along = up10(s.lengthCm);
    across = up10(Math.max(STEP_CM * 3, s.lengthCm / 2));
  } else if (s.method === "row") {
    along = up10(s.lengthCm);
    across = up10(Math.max(1, s.rows) * (rowSpacingCm ?? FALLBACK_ROW_SPACING_CM));
  } else {
    const spacing = plantSpacingCm ?? across1;
    const rows = Math.max(1, Math.min(s.rows, s.count));
    // 엇갈려 심기는 줄마다 포기 간격 두 배 (beds.ts autoPlantCount와 같은 규칙)
    const step = s.layout === "staggered" && rows > 1 ? spacing * 2 : spacing;
    along = up10(Math.ceil(s.count / rows) * step);
    across = up10(rows * across1);
  }
  const kind: Size["kind"] = along < across ? "plot" : "bed";
  return s.orientation === "horizontal" ? { kind, w_cm: along, h_cm: across } : { kind, w_cm: across, h_cm: along };
}

export type Box = { x_cm: number; y_cm: number; w_cm: number; h_cm: number };

// 자석 거리: 이 안에 다른 구획 가장자리나 밭 끝이 있으면 붙는다.
export const MAGNET_CM = 15;

function nearest(value: number, targets: number[], threshold: number): number | null {
  let best: number | null = null;
  for (const t of targets) if (Math.abs(t - value) <= threshold && (best === null || Math.abs(t - value) < Math.abs(best - value))) best = t;
  return best;
}

const snapStep = (v: number) => Math.round(v / STEP_CM) * STEP_CM;

// 옮기기: 왼쪽·오른쪽(위·아래) 가장자리 중 가까운 쪽을 다른 구획의 가장자리에 맞추고, 없으면 10cm 격자.
export function snapMove(box: Box, others: Box[], field: { w: number; h: number }, threshold = MAGNET_CM): Box {
  const xs = [0, field.w, ...others.flatMap((o) => [o.x_cm, o.x_cm + o.w_cm])];
  const ys = [0, field.h, ...others.flatMap((o) => [o.y_cm, o.y_cm + o.h_cm])];
  const axis = (pos: number, size: number, targets: number[], max: number) => {
    const a = nearest(pos, targets, threshold);
    const b = nearest(pos + size, targets, threshold);
    let v: number;
    if (a !== null && (b === null || Math.abs(a - pos) <= Math.abs(b - (pos + size)))) v = a;
    else if (b !== null) v = b - size;
    else v = snapStep(pos);
    return Math.min(Math.max(0, v), Math.max(0, max - size));
  };
  return { ...box, x_cm: axis(box.x_cm, box.w_cm, xs, field.w), y_cm: axis(box.y_cm, box.h_cm, ys, field.h) };
}

// 크기 조절(오른쪽 아래 손잡이): 오른쪽·아래 가장자리를 다른 구획 가장자리에 맞추고, 없으면 10cm 격자.
export function snapResize(box: Box, others: Box[], field: { w: number; h: number }, threshold = MAGNET_CM): Box {
  const xs = [field.w, ...others.flatMap((o) => [o.x_cm, o.x_cm + o.w_cm])];
  const ys = [field.h, ...others.flatMap((o) => [o.y_cm, o.y_cm + o.h_cm])];
  const right = nearest(box.x_cm + box.w_cm, xs, threshold) ?? snapStep(box.x_cm + box.w_cm);
  const bottom = nearest(box.y_cm + box.h_cm, ys, threshold) ?? snapStep(box.y_cm + box.h_cm);
  return {
    ...box,
    w_cm: Math.min(Math.max(STEP_CM, right - box.x_cm), field.w - box.x_cm),
    h_cm: Math.min(Math.max(STEP_CM, bottom - box.y_cm), field.h - box.y_cm),
  };
}

// 숫자 입력도 10cm 단위로 맞춘다.
export const roundStep = (v: number) => Math.max(STEP_CM, snapStep(v));
