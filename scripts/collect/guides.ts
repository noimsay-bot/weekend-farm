// 재해예방 글에서 상황별 대응 문구를 고른다. 대책·관리 문장만 원문 그대로 모은다.
import { sentences } from "./text";

const SITUATIONS: [string, RegExp][] = [
  ["frost", /서리/],
  ["cold_wave", /한파|저온|동해/],
  ["heat_wave", /폭염|고온/],
  ["typhoon", /태풍|강풍/],
  ["heavy_rain", /호우|집중호우|장마|침수/],
];

export function guidesFromArticle(title: string, text: string, sourceUrl: string) {
  const situation = SITUATIONS.find(([, re]) => re.test(title))?.[0];
  if (!situation) return [];
  const actions = sentences(text).filter((s) => /(해야|한다|좋다|준다|하도록|필요|막는|줄인)/.test(s)).slice(0, 8);
  if (actions.length === 0) return [];
  return [
    {
      situation,
      crop_id: null,
      guide_text: actions.join("\n"),
      source_text: `${title}\n${actions.join("\n")}`,
      source_url: sourceUrl,
    },
  ];
}
