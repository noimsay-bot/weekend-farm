// 주간농사정보(농촌진흥청) 요약에서 작물별 문장을 원문 그대로 고른다.
// 요약은 분야 이름 줄(밭작물, 채소, 과수 …) 아래에 '• (가을 배추‧무) 내용' 형태의 항목이 이어진다.

const SUMMARY_FIELDS = new Set(["밭작물", "채소"]);
const OTHER_FIELDS = new Set(["농업", "정보", "벼", "과수", "화훼", "특작", "특용작물", "축산", "양봉"]);
const PEST = /(\S*병|\S*나방|진딧물|응애|총채벌레|노린재|굴파리|잎벌레|해충)/;

export type WeeklyNote = { cropId: string; cropName: string; pest: string | null; summary: string };

export function extractWeeklySummaries(text: string, crops: { id: string; name: string }[]): WeeklyNote[] {
  const lines = text.split("\n").map((l) => l.trim());
  const start = lines.findIndex((l) => l.replace(/\s/g, "") === "요약");
  const end = lines.findIndex((l, i) => i > start && /^제1장/.test(l));
  if (start < 0) return [];

  const items: { labels: string[]; body: string }[] = [];
  let field: string | null = null;
  for (const line of lines.slice(start + 1, end < 0 ? undefined : end)) {
    if (SUMMARY_FIELDS.has(line)) field = line;
    else if (OTHER_FIELDS.has(line)) field = null;
    else if (!field) continue;
    else if (line.startsWith("•")) {
      const m = line.match(/^•\s*\(([^)]+)\)\s*(.*)$/);
      if (!m) continue;
      // '가을 배추‧무' → ['배추', '무']: 구분자로 나누고 각 조각의 마지막 낱말을 작물명으로 본다
      const labels = m[1].split(/[‧·ㆍ,、/]/).map((s) => s.trim().split(/\s+/).pop()!).filter(Boolean);
      items.push({ labels, body: `(${m[1]}) ${m[2]}`.trim() });
    } else if (/^[*※-]/.test(line) && items.length) {
      items[items.length - 1].body += ` ${line}`;
    }
  }

  const out: WeeklyNote[] = [];
  for (const crop of crops) {
    const base = crop.name.replace(/\(.*\)/, "").trim();
    const hits = items.filter((i) => i.labels.includes(base));
    if (!hits.length) continue;
    const summary = hits.map((h) => h.body).join(" ");
    out.push({ cropId: crop.id, cropName: crop.name, pest: summary.match(PEST)?.[1] ?? null, summary });
  }
  return out;
}
