// 지상관측(ASOS) 주요 관측소와 기상특보 발표 관서. 좌표는 기상청 관측소 메타데이터 기준 근사값.
// 농장에서 가장 가까운 관측소를 고른다 (관측값은 밭과 차이가 날 수 있음 — 계획서 리스크).

export type Station = { id: string; name: string; lat: number; lon: number };

export const ASOS_STATIONS: Station[] = [
  { id: "90", name: "속초", lat: 38.2509, lon: 128.5647 },
  { id: "93", name: "북춘천", lat: 37.9474, lon: 127.7544 },
  { id: "95", name: "철원", lat: 38.1479, lon: 127.3042 },
  { id: "98", name: "동두천", lat: 37.9019, lon: 127.0607 },
  { id: "99", name: "파주", lat: 37.8859, lon: 126.7665 },
  { id: "100", name: "대관령", lat: 37.6771, lon: 128.7183 },
  { id: "101", name: "춘천", lat: 37.9026, lon: 127.7357 },
  { id: "105", name: "강릉", lat: 37.7515, lon: 128.891 },
  { id: "108", name: "서울", lat: 37.5714, lon: 126.9658 },
  { id: "112", name: "인천", lat: 37.4777, lon: 126.6249 },
  { id: "114", name: "원주", lat: 37.3375, lon: 127.9466 },
  { id: "119", name: "수원", lat: 37.2723, lon: 126.9853 },
  { id: "127", name: "충주", lat: 36.9705, lon: 127.9525 },
  { id: "129", name: "서산", lat: 36.7766, lon: 126.4939 },
  { id: "131", name: "청주", lat: 36.6392, lon: 127.4407 },
  { id: "133", name: "대전", lat: 36.372, lon: 127.3721 },
  { id: "135", name: "추풍령", lat: 36.2203, lon: 127.9946 },
  { id: "136", name: "안동", lat: 36.5729, lon: 128.7073 },
  { id: "140", name: "군산", lat: 36.0053, lon: 126.7614 },
  { id: "143", name: "대구", lat: 35.878, lon: 128.653 },
  { id: "146", name: "전주", lat: 35.8408, lon: 127.1172 },
  { id: "152", name: "울산", lat: 35.5601, lon: 129.32 },
  { id: "156", name: "광주", lat: 35.1729, lon: 126.8916 },
  { id: "159", name: "부산", lat: 35.1047, lon: 129.032 },
  { id: "162", name: "통영", lat: 34.8455, lon: 128.4356 },
  { id: "165", name: "목포", lat: 34.8169, lon: 126.3812 },
  { id: "168", name: "여수", lat: 34.7393, lon: 127.7406 },
  { id: "184", name: "제주", lat: 33.5141, lon: 126.5297 },
  { id: "201", name: "강화", lat: 37.7074, lon: 126.4463 },
  { id: "202", name: "양평", lat: 37.4886, lon: 127.4945 },
  { id: "203", name: "이천", lat: 37.264, lon: 127.4842 },
];

// 기상특보 조회 지점(발표 관서)
export const WARNING_OFFICES: Station[] = [
  { id: "109", name: "서울(수도권)", lat: 37.5714, lon: 126.9658 },
  { id: "105", name: "강원", lat: 37.7515, lon: 128.891 },
  { id: "131", name: "청주", lat: 36.6392, lon: 127.4407 },
  { id: "133", name: "대전", lat: 36.372, lon: 127.3721 },
  { id: "146", name: "전주", lat: 35.8408, lon: 127.1172 },
  { id: "156", name: "광주", lat: 35.1729, lon: 126.8916 },
  { id: "143", name: "대구", lat: 35.878, lon: 128.653 },
  { id: "159", name: "부산", lat: 35.1047, lon: 129.032 },
  { id: "184", name: "제주", lat: 33.5141, lon: 126.5297 },
];

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(bLat - aLat);
  const dLon = r(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export function nearest(lat: number, lon: number, list: Station[] = ASOS_STATIONS): Station & { km: number } {
  return list
    .map((s) => ({ ...s, km: distanceKm(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.km - b.km)[0];
}

export { distanceKm };

// 지역 판정 (관행 시기 적용용). 제주 / 남부(전라·경상) / 중부(수도권·강원·충청).
// 북위 36° 부근을 경계로 보는 근사 규칙이며, 관행 시기가 '전국'만 있으면 전국 값을 쓴다.
export function regionOf(lat: number, lon: number): "제주" | "남부" | "중부" {
  if (lat < 34.0 && lon < 127.2) return "제주";
  if (lat < 36.0) return "남부";
  return "중부";
}
