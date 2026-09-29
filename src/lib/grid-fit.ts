// 밭 격자를 스크롤 없이 한 화면에 맞추는 크기 (가로·세로 중 더 빡빡한 쪽에 맞춘다).
// 세로 여유 = 화면 높이 - 위 도구 영역·아래 메뉴. 확대하면 그만큼 커지고 스크롤된다.
export const GRID_MAX_HEIGHT = "max(200px, calc(100dvh - 360px))";

export function gridWidth(cols: number, rows: number, zoom = 1): string {
  const fit = `min(100%, calc(${GRID_MAX_HEIGHT} * ${cols} / ${rows}))`;
  return zoom === 1 ? fit : `calc(${fit} * ${zoom})`;
}
