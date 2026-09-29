// 작물 궁합 판정 (계획서 M13). 붙은 칸(상하좌우·대각선 8방향)과 같은 칸 사이작물을 본다.
// 경고만 하고 막지 않는다.

export type Companion = {
  crop_a_id: string;
  crop_b_id: string;
  relation: "good" | "bad";
  reason: string | null;
  source_text: string | null;
  source_url: string | null;
};

export type Cell = { x: number; y: number; crop_id: string; companion_crop_id: string | null };

export type CompanionHit = {
  x: number;
  y: number;
  otherX: number;
  otherY: number;
  sameCell: boolean;
  companion: Companion;
};

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function companionIndex(list: Companion[]): Map<string, Companion> {
  return new Map(list.map((c) => [pairKey(c.crop_a_id, c.crop_b_id), c]));
}

export function goodCompanionsOf(cropId: string, list: Companion[]): string[] {
  return list
    .filter((c) => c.relation === "good" && (c.crop_a_id === cropId || c.crop_b_id === cropId))
    .map((c) => (c.crop_a_id === cropId ? c.crop_b_id : c.crop_a_id));
}

const NEIGHBORS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

// 칸마다 주작물 기준으로 이웃 칸의 주작물·사이작물, 같은 칸 사이작물과의 궁합을 찾는다.
export function companionHits(cells: Cell[], index: Map<string, Companion>): CompanionHit[] {
  const at = new Map(cells.map((c) => [`${c.x},${c.y}`, c]));
  const hits: CompanionHit[] = [];
  const seen = new Set<string>();

  for (const cell of cells) {
    if (cell.companion_crop_id) {
      const comp = index.get(pairKey(cell.crop_id, cell.companion_crop_id));
      if (comp) hits.push({ x: cell.x, y: cell.y, otherX: cell.x, otherY: cell.y, sameCell: true, companion: comp });
    }
    for (const [dx, dy] of NEIGHBORS) {
      const other = at.get(`${cell.x + dx},${cell.y + dy}`);
      if (!other) continue;
      const edge = [cell.x, cell.y, other.x, other.y].join(",");
      const reverse = [other.x, other.y, cell.x, cell.y].join(",");
      if (seen.has(reverse)) continue;
      seen.add(edge);
      // 두 칸의 주작물·사이작물 모든 조합
      const mine = [cell.crop_id, cell.companion_crop_id].filter(Boolean) as string[];
      const theirs = [other.crop_id, other.companion_crop_id].filter(Boolean) as string[];
      const found = new Set<string>();
      for (const a of mine) {
        for (const b of theirs) {
          if (a === b) continue;
          const key = pairKey(a, b);
          const comp = index.get(key);
          if (!comp || found.has(key)) continue;
          found.add(key);
          hits.push({ x: cell.x, y: cell.y, otherX: other.x, otherY: other.y, sameCell: false, companion: comp });
        }
      }
    }
  }
  return hits;
}
