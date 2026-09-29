// 원문에서 병해충 예방 방제 시기를 뽑는다.
// - "N월" 범위가 있으면 calendar_by_region (지역 표기가 없으므로 '전국')
// - "장마" 등 기상 조건만 있으면 weather
import { sentences } from "./text";

const PEST = /(\S*병|\S*나방|진딧물|응애|총채벌레|굴파리|벼룩잎벌레|노린재|파리|벌레|해충)/;
const ACTION = /방제|예방|살포|뿌려|약제|농약/;
const MONTHS = /(\d{1,2})\s*월(?:\s*(?:초|중|하|말|상순|중순|하순))?\s*(?:~|부터|에서)?\s*(?:(\d{1,2})\s*월)?/;

export function preventionFromText(cropId: string, text: string, sourceUrl: string) {
  const rows: Record<string, unknown>[] = [];
  for (const s of sentences(text)) {
    if (!ACTION.test(s)) continue;
    const pest = s.match(PEST)?.[1];
    if (!pest) continue;
    const m = s.match(MONTHS);
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : start;
      if (start >= 1 && start <= 12 && end >= 1 && end <= 12) {
        rows.push({
          crop_id: cropId,
          pest_name: pest,
          basis: "calendar_by_region",
          region: "전국",
          start_month: start,
          start_day: 1,
          end_month: end,
          end_day: 28,
          source_text: s,
          source_url: sourceUrl,
        });
        continue;
      }
    }
    const weather = s.match(/장마\s*(?:전|이전|기간|중|후)?|비가\s*(?:잦|많)\S*|습한\s*날씨/)?.[0];
    if (weather) {
      rows.push({
        crop_id: cropId,
        pest_name: pest,
        basis: "weather",
        weather_condition: weather,
        source_text: s,
        source_url: sourceUrl,
      });
    }
  }
  return rows;
}
