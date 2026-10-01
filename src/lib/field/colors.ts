// 작물 색: 차분한 팔레트 (밭 그림·범례 공통).
const PALETTE = [
  { fill: "#e3efd9", stroke: "#4c8a3f" },
  { fill: "#e3e7f7", stroke: "#4f5fb8" },
  { fill: "#fbecd5", stroke: "#b06a12" },
  { fill: "#dcefec", stroke: "#2b8a7e" },
  { fill: "#efe2f2", stroke: "#8a4ca0" },
  { fill: "#efe6dd", stroke: "#8a6248" },
  { fill: "#f7e1e6", stroke: "#b8466a" },
  { fill: "#dfeaf6", stroke: "#3b78b5" },
];

// 한 화면에 나오는 작물끼리는 겹치지 않게: 작물 id 목록(정렬)에서의 순서로 색을 준다.
export function toneMap(cropIds: string[]): Map<string, (typeof PALETTE)[number]> {
  const ids = [...new Set(cropIds)].sort();
  return new Map(ids.map((id, i) => [id, PALETTE[i % PALETTE.length]]));
}
