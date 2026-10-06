// 밭 구획(두둑·네모 밭)과 구획 심기의 기하 계산. 좌표는 밭 왼쪽 위 기준 cm.
// DB 함수 bed_planting_rect / bed_planting_cells와 같은 규칙을 쓴다 (테스트로 확인).

export type Bed = { id: string; kind: "bed" | "plot"; x_cm: number; y_cm: number; w_cm: number; h_cm: number; label: string | null };

export type BedPlanting = {
  id: string;
  bed_id: string;
  crop_id: string;
  rows: number;
  // 여러 줄일 때 parallel(양옆 나란히) / staggered(줄끼리 엇갈려)
  layout: RowLayout;
  method: SowPattern;
  start_cm: number;
  length_cm: number | null;
  plant_count: number | null;
  carried_from_planting_id: string | null;
};

export type RowLayout = "parallel" | "staggered";
// plant 모종 정식 / row 줄뿌림 / hill 점뿌림 / broadcast 흩어뿌림
export type SowPattern = "plant" | "row" | "hill" | "broadcast";
export const SOW_PATTERN_LABEL: Record<SowPattern, string> = { plant: "모종 심기", row: "줄뿌림", hill: "점뿌림", broadcast: "흩어뿌림" };
// 줄뿌림·흩어뿌림은 포기 수를 세지 않는다.
export const countsPlants = (m: SowPattern) => m === "plant" || m === "hill";

export type Rect = { x0: number; y0: number; x1: number; y1: number };

// 세로 두둑(세로가 더 길거나 같음)은 y 방향으로 심고, 가로 두둑은 x 방향으로 심는다.
export const isVertical = (b: Pick<Bed, "w_cm" | "h_cm">) => b.h_cm >= b.w_cm;
export const bedLength = (b: Pick<Bed, "w_cm" | "h_cm">) => (isVertical(b) ? b.h_cm : b.w_cm);
export const bedWidth = (b: Pick<Bed, "w_cm" | "h_cm">) => (isVertical(b) ? b.w_cm : b.h_cm);

export function segmentRect(b: Bed, p: Pick<BedPlanting, "start_cm" | "length_cm">): Rect {
  const len = bedLength(b);
  const s = Math.min(p.start_cm, len);
  const e = Math.min(len, p.start_cm + (p.length_cm ?? len));
  return isVertical(b)
    ? { x0: b.x_cm, y0: b.y_cm + s, x1: b.x_cm + b.w_cm, y1: b.y_cm + e }
    : { x0: b.x_cm + s, y0: b.y_cm, x1: b.x_cm + e, y1: b.y_cm + b.h_cm };
}

// 위치 칸: 칸 중심이 구간 안에 있으면 포함. 하나도 없으면 구간 중심 칸.
export function segmentCells(r: Rect, cellCm: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let x = Math.floor(r.x0 / cellCm); x <= Math.ceil(r.x1 / cellCm); x++) {
    for (let y = Math.floor(r.y0 / cellCm); y <= Math.ceil(r.y1 / cellCm); y++) {
      const cx = (x + 0.5) * cellCm;
      const cy = (y + 0.5) * cellCm;
      if (cx >= r.x0 && cx < r.x1 && cy >= r.y0 && cy < r.y1) out.push({ x, y });
    }
  }
  if (out.length === 0) out.push({ x: Math.floor((r.x0 + r.x1) / 2 / cellCm), y: Math.floor((r.y0 + r.y1) / 2 / cellCm) });
  return out;
}

// 포기 수 자동 계산: 두둑은 줄 수 × (구간 길이 / 포기 간격), 네모 밭은 가로·세로로 포기 간격만큼.
// 엇갈려 심기(여러 줄)는 줄마다 포기 간격을 두 배로 띄워 지그재그로 심는다 — 나란히 두 줄에 4포기 들어갈 자리에 2포기.
export function autoPlantCount(
  b: Bed,
  p: Pick<BedPlanting, "rows" | "start_cm" | "length_cm"> & { method?: SowPattern; layout?: RowLayout },
  spacingCm: number | null,
): number | null {
  if (p.method && !countsPlants(p.method)) return null;
  if (!spacingCm || spacingCm <= 0) return null;
  const r = segmentRect(b, p);
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  if (b.kind === "plot") return Math.max(1, Math.floor(w / spacingCm)) * Math.max(1, Math.floor(h / spacingCm));
  const along = isVertical(b) ? h : w;
  const step = p.layout === "staggered" && p.rows > 1 ? spacingCm * 2 : spacingCm;
  return p.rows * Math.max(1, Math.floor(along / step));
}

export const plantCountOf = (b: Bed, p: BedPlanting, spacingCm: number | null) =>
  countsPlants(p.method) ? (p.plant_count ?? autoPlantCount(b, p, spacingCm) ?? 0) : 0;

// 줄뿌림 줄 수: 두둑 폭을 적정 줄간격으로 나눈 값 (1~12).
export const autoRowCount = (b: Pick<Bed, "w_cm" | "h_cm">, rowSpacingCm: number | null) =>
  rowSpacingCm && rowSpacingCm > 0 ? Math.min(12, Math.max(1, Math.floor(bedWidth(b) / rowSpacingCm))) : null;

// 줄뿌림 그림용: 줄마다 구간 양 끝을 잇는 선.
export function sowLines(b: Bed, p: BedPlanting): { x1: number; y1: number; x2: number; y2: number }[] {
  const r = segmentRect(b, p);
  const rows = Math.max(1, p.rows);
  return Array.from({ length: rows }, (_, i) => {
    const t = (i + 0.5) / rows;
    return isVertical(b)
      ? { x1: r.x0 + t * (r.x1 - r.x0), y1: r.y0, x2: r.x0 + t * (r.x1 - r.x0), y2: r.y1 }
      : { x1: r.x0, y1: r.y0 + t * (r.y1 - r.y0), x2: r.x1, y2: r.y0 + t * (r.y1 - r.y0) };
  });
}

// 흩어뿌림 그림용: 구간 안에 고르게 흩어진 점 (매번 같은 모양이 나오도록 고정된 난수).
export function scatterPoints(r: Rect, n: number): { x: number; y: number }[] {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: n }, () => ({ x: r.x0 + (0.06 + 0.88 * rand()) * (r.x1 - r.x0), y: r.y0 + (0.08 + 0.84 * rand()) * (r.y1 - r.y0) }));
}

// 그림용 포기 위치. 두둑은 줄마다 고르게(엇갈려 심기면 줄마다 반 간격씩 어긋나게), 네모 밭은 정사각에 가깝게 배치.
export function plantPositions(b: Bed, p: BedPlanting, count: number): { x: number; y: number }[] {
  const r = segmentRect(b, p);
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  const out: { x: number; y: number }[] = [];
  if (count <= 0) return out;
  if (b.kind === "plot") {
    const cols = Math.max(1, Math.round(Math.sqrt((count * w) / h)));
    const rows = Math.ceil(count / cols);
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / cols);
      const inRow = row === rows - 1 ? count - cols * (rows - 1) : cols;
      const col = i % cols;
      out.push({ x: r.x0 + ((col + 0.5) / inRow) * w, y: r.y0 + ((row + 0.5) / rows) * h });
    }
    return out;
  }
  const rows = Math.max(1, Math.min(p.rows, count));
  const perRow = Math.ceil(count / rows);
  for (let i = 0; i < count; i++) {
    const row = i % rows;
    const j = Math.floor(i / rows);
    const n = row < count - (perRow - 1) * rows ? perRow : perRow - 1;
    const across = (row + 0.5) / rows;
    const offset = p.layout === "staggered" && rows > 1 ? (row % 2 ? 0.75 : 0.25) : 0.5;
    const along = (j + offset) / Math.max(1, n);
    out.push(isVertical(b) ? { x: r.x0 + across * w, y: r.y0 + along * h } : { x: r.x0 + along * w, y: r.y0 + across * h });
  }
  return out;
}
