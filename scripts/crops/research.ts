// 작물 조사 도구 (자료 작성용, DB 접근 없음)
//   npm run crops:research -- nongsaro 배추          농사로 텃밭가꾸기 원문 (NONGSARO_GARDEN_KEY)
//   npm run crops:research -- videos 배추            광닭이·농사친구 채널에서 검색
//   npm run crops:research -- transcript <videoId>   자동 자막 텍스트
// 영상 자막은 요약용 참고로만 쓰고 원문을 자료에 옮기지 않는다.
import { htmlToText } from "../collect/text";

const CHANNELS = [
  { name: "광닭이", path: "@광닭이티비" },
  { name: "농사친구", path: "channel/UCVGT1BEkyns0nPabsFgO18g" },
];
const UA = "Mozilla/5.0";
const ANDROID_UA = "com.google.android.youtube/20.10.38 (Linux; U; Android 14)";

async function nongsaro(name: string) {
  const key = process.env.NONGSARO_GARDEN_KEY;
  if (!key) throw new Error("NONGSARO_GARDEN_KEY 없음");
  for (const section of ["335001", "335002", "335003"]) {
    const xml = await (await fetch(`http://api.nongsaro.go.kr/service/fildMnfct/fildMnfctList?apiKey=${key}&sSeCode=${section}&numOfRows=200`)).text();
    for (const item of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
      const title = item.match(/<cntntsSj><!\[CDATA\[([^\]]*)/)?.[1]?.trim() ?? "";
      if (title !== name && !title.startsWith(`${name} `)) continue;
      const no = item.match(/<cntntsNo><!\[CDATA\[(\d+)/)?.[1];
      console.log(`# ${title}\nhttps://www.nongsaro.go.kr/portal/ps/psz/psza/contentSub.ps?menuId=PS00199&cntntsNo=${no}\n`);
      console.log(htmlToText(item.match(/<cn><!\[CDATA\[([\s\S]*?)\]\]><\/cn>/)?.[1] ?? ""));
      return;
    }
  }
  console.log(`농사로 텃밭가꾸기에 '${name}' 글이 없습니다.`);
}

async function videos(query: string) {
  for (const ch of CHANNELS) {
    const html = await (await fetch(`https://www.youtube.com/${ch.path}/search?query=${encodeURIComponent(query)}&hl=ko`, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR" } })).text();
    const data = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/)?.[1];
    const rows: string[] = [];
    const walk = (n: unknown) => {
      if (!n || typeof n !== "object") return;
      const v = (n as { videoRenderer?: Record<string, { simpleText?: string; runs?: { text: string }[] } & string> }).videoRenderer;
      if (v) rows.push(`${v.videoId} | ${v.title?.runs?.map((r) => r.text).join("")} | ${v.publishedTimeText?.simpleText ?? ""} | ${v.viewCountText?.simpleText ?? ""}`);
      for (const k in n as object) walk((n as Record<string, unknown>)[k]);
    };
    if (data) walk(JSON.parse(data));
    console.log(`## ${ch.name}\n${rows.slice(0, 20).join("\n") || "결과 없음"}\n`);
  }
}

async function transcript(id: string) {
  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": ANDROID_UA },
    body: JSON.stringify({ videoId: id, context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", hl: "ko", androidSdkVersion: 34 } } }),
  });
  const j = (await res.json()) as {
    videoDetails?: { title?: string; author?: string };
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: { languageCode: string; baseUrl: string }[] } };
  };
  const tracks = j.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const track = tracks.find((t) => t.languageCode === "ko");
  console.log(`# ${j.videoDetails?.title ?? id} (${j.videoDetails?.author ?? ""})\nhttps://www.youtube.com/watch?v=${id}\n`);
  if (!track) return console.log("한국어 자막 없음");
  const xml = await (await fetch(track.baseUrl, { headers: { "User-Agent": ANDROID_UA } })).text();
  const text = [...xml.matchAll(/<(?:text|p)[^>]*>([\s\S]*?)<\/(?:text|p)>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, "").replace(/&amp;#39;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"'))
    .join(" ")
    .replace(/\s+/g, " ");
  console.log(text);
}

const [cmd, arg] = process.argv.slice(2);
const run = { nongsaro, videos, transcript }[cmd as "nongsaro" | "videos" | "transcript"];
if (!run || !arg) {
  console.error("사용법: npm run crops:research -- nongsaro|videos|transcript <값>");
  process.exit(1);
}
run(arg).catch((e) => {
  console.error(e);
  process.exit(1);
});
