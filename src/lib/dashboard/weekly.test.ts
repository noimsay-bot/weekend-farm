import { describe, expect, it } from "vitest";
import { extractCropPestNotes, htmlToPlain } from "./weekly";

describe("weekly farm info", () => {
  it("picks crop sentences mentioning pests and control", () => {
    const text = htmlToPlain(
      "<p>고추 탄저병은 비가 잦으면 발생이 늘어나므로 예방 위주로 방제한다.</p><p>배추는 아주심기를 마친다.</p><p>배추 좀나방 발생에 주의한다.</p>",
    );
    const notes = extractCropPestNotes(text, [
      { id: "1", name: "고추" },
      { id: "2", name: "배추" },
      { id: "3", name: "깻잎(들깨)" },
    ]);
    expect(notes).toEqual([
      { cropId: "1", cropName: "고추", pest: "탄저병", summary: "고추 탄저병은 비가 잦으면 발생이 늘어나므로 예방 위주로 방제한다." },
      { cropId: "2", cropName: "배추", pest: "좀나방", summary: "배추 좀나방 발생에 주의한다." },
    ]);
  });
});
