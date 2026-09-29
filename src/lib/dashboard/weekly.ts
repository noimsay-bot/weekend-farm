// 주간농사정보 본문에서 작물별 병해충 문장을 원문 그대로 고른다.

export function htmlToPlain(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

const PEST = /(\S*병|\S*나방|진딧물|응애|총채벌레|노린재|굴파리|잎벌레|해충)/;

export function extractCropPestNotes(text: string, crops: { id: string; name: string }[]) {
  const lines = text.split(/\n|(?<=다\.)\s+/).map((l) => l.trim()).filter(Boolean);
  const out: { cropId: string; cropName: string; pest: string | null; summary: string }[] = [];
  for (const crop of crops) {
    const base = crop.name.replace(/\(.*\)/, "");
    const hits = lines.filter((l) => l.includes(base) && PEST.test(l) && /방제|예방|발생|주의/.test(l));
    if (!hits.length) continue;
    out.push({ cropId: crop.id, cropName: crop.name, pest: hits[0].match(PEST)?.[1] ?? null, summary: hits.slice(0, 3).join(" ") });
  }
  return out;
}
