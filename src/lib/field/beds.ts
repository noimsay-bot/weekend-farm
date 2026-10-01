// 밭 구획(두둑·네모 밭)과 구획 심기의 기하 계산. 좌표는 밭 왼쪽 위 기준 cm.
// DB 함수 bed_planting_rect / bed_planting_cells와 같은 규칙을 쓴다 (테스트로 확인).

export type Bed = { id: string; kind: "bed" | "plot"; x_cm: number; y_cm: number; w_cm: number; h_cm: number; label: string | null };

export type BedPlanting = {
  id: string;
  bed_id: string;
  crop_id: string;
  rows: number;
  start_cm: number;
  length_cm: number | null;
  plant_count: number | null;
  carried_from_planting_id: string | null;
};

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
export function autoPlantCount(b: Bed, p: Pick<BedPlanting, "rows" | "start_cm" | "length_cm">, spacingCm: number | null): number | null {
  if (!spacingCm || spacingCm <= 0) return null;
  const r = segmentRect(b, p);
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  if (b.kind === "plot") return Math.max(1, Math.floor(w / spacingCm)) * Math.max(1, Math.floor(h / spacingCm));
  const along = isVertical(b) ? h : w;
  return p.rows * Math.max(1, Math.floor(along / spacingCm));
}

export const plantCountOf = (b: Bed, p: BedPlanting, spacingCm: number | null) => p.plant_count ?? autoPlantCount(b, p, spacingCm) ?? 0;

// 그림용 포기 위치. 두둑은 줄마다 고르게, 네모 밭은 정사각에 가깝게 배치.
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
    const along = (j + 0.5) / Math.max(1, n);
    out.push(isVertical(b) ? { x: r.x0 + across * w, y: r.y0 + along * h } : { x: r.x0 + along * w, y: r.y0 + across * h });
  }
  return out;
}

// 끌기·크기 조절은 10cm 단위로 맞춘다.
export const snap = (v: number, step = 10) => Math.round(v / step) * step;
