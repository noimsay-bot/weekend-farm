// 위치 기반 기록 유도 (계획서 M7): 농장 반경 안이고 오늘 내가 입력한 기록이 없으면 하루 1회 빠른 기록 시트.
import { distanceKm } from "./weather/stations";

export function withinRadius(pos: { lat: number; lng: number }, farm: { lat: number; lng: number }, radiusM: number): boolean {
  return distanceKm(pos.lat, pos.lng, farm.lat, farm.lng) * 1000 <= radiusM;
}

export function shouldPrompt(input: {
  today: string;
  lastShownOn: string | null; // 닫았거나 띄운 날
  inside: boolean;
  hasMyLogToday: boolean; // 비 자동 기록 제외
}): boolean {
  return input.inside && !input.hasMyLogToday && input.lastShownOn !== input.today;
}
