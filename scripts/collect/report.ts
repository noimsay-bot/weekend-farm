import type { CropFieldDef } from "../../src/lib/crop-fields";

export type CropReport = {
  name: string;
  gardenUrl: string | null;
  fertilizer: boolean;
  pesticides: number;
  missingMoa: number;
  notes: { field_name: string; extracted_value: string | null; approved: boolean; manual_input: boolean }[];
};

export function buildMissingReport(crops: CropReport[], required: CropFieldDef[], skipped: string[]): string {
  const lines: string[] = [];
  lines.push("# 작물 데이터 누락 리포트", "");
  lines.push(`생성: ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} (KST)`, "");
  if (skipped.length) {
    lines.push("## 건너뛴 수집", "", ...skipped.map((s) => `- ${s}`), "");
  }
  lines.push(
    "## 공통",
    "",
    "- 작물 궁합(crop_companions): 농사로 '섞어짓기' 글에 작물 쌍별 궁합이 서술되어 있지 않아 비워 둠. 자료에 없는 쌍은 만들지 않음.",
    "- 품종별 값: 농사로에 품종별 수치가 없어 비워 둠 (사용자 입력 대상).",
    "- 지역별 시기: 텃밭가꾸기 원문에 지역 구분이 없어 '전국'으로 저장. 중부/남부 구분 자료는 추가 확인 필요.",
    "",
  );

  const withoutGarden = crops.filter((c) => !c.gardenUrl).map((c) => c.name);
  lines.push(`## 농사로 텃밭가꾸기 원문이 없는 작물 (${withoutGarden.length}종)`, "");
  lines.push(withoutGarden.length ? withoutGarden.join(", ") : "없음", "");
  lines.push("→ 관리자 화면에서 수동 입력하거나 작물을 삭제하세요.", "");

  lines.push("## 작물별 누락 필드", "");
  lines.push("| 작물 | 값 없음 (근거 없음) | 근거 문장만 있음 (값 추출 실패) | 비료 처방 | 농약 성분 | 작용기작 누락 |");
  lines.push("|---|---|---|---|---|---|");
  for (const c of crops) {
    const byField = new Map(c.notes.map((n) => [n.field_name, n]));
    const none: string[] = [];
    const candidateOnly: string[] = [];
    for (const f of required) {
      const n = byField.get(f.name);
      if (n?.approved || n?.manual_input) continue;
      if (!n) none.push(f.label);
      else if (n.extracted_value === null) candidateOnly.push(f.label);
    }
    lines.push(
      `| ${c.name} | ${none.join(", ") || "—"} | ${candidateOnly.join(", ") || "—"} | ${c.fertilizer ? "있음" : "없음"} | ${c.pesticides}건 | ${c.missingMoa ? `${c.missingMoa}건` : "—"} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
