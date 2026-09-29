// 농사로 본문 HTML을 줄 단위 평문으로 정리한다.

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&sim;": "~",
  "&middot;": "·",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&times;": "×",
  "&deg;": "°",
};

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? " ")
    .replace(/[ \t　]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

// 문장 단위로 쪼갠다. 줄바꿈과 불릿 기호를 경계로 쓴다.
export function sentences(text: string): string[] {
  return text
    .split(/\n|(?=\s[•■▶]\s)|(?<=다\.)\s+/)
    .map((s) => s.replace(/^[\s•■▶·\-]+/, "").trim())
    .filter((s) => s.length > 1);
}
