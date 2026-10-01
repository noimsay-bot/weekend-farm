// 공공 API 클라이언트. 응답 필드명은 각 기관 명세 기준.
import { getText, parseXml, xmlHeader, xmlItems } from "./http";
import { htmlToText } from "./text";

// ── 농사로 텃밭가꾸기 (api.nongsaro.go.kr/service/fildMnfct) ──
const NONGSARO = "http://api.nongsaro.go.kr/service";
const VEGETABLE_SECTION = "335001";

export type GardenArticle = { cntntsNo: string; title: string };

function assertNongsaroOk(doc: unknown) {
  const h = xmlHeader(doc);
  if (h && h.code !== "00") throw new Error(`농사로 API 오류 ${h.code}: ${h.msg}`);
}

export async function listGardenArticles(apiKey: string): Promise<GardenArticle[]> {
  const out: GardenArticle[] = [];
  for (let page = 1; page <= 30; page++) {
    const url = `${NONGSARO}/fildMnfct/fildMnfctList?apiKey=${apiKey}&sSeCode=${VEGETABLE_SECTION}&pageNo=${page}&numOfRows=50`;
    const doc = parseXml(await getText(url));
    assertNongsaroOk(doc);
    const items = xmlItems(doc);
    for (const item of items) {
      const title = item.cntntsSj ?? item.sj ?? "";
      if (item.cntntsNo && title) out.push({ cntntsNo: String(item.cntntsNo), title: String(title) });
    }
    if (items.length < 50) break;
  }
  return out;
}

// 상세 본문: 명세상 필드명이 서비스마다 달라 HTML이 담긴 가장 긴 필드를 본문으로 본다.
export async function getGardenArticle(apiKey: string, cntntsNo: string): Promise<{ text: string; url: string }> {
  const url = `${NONGSARO}/fildMnfct/fildMnfctView?apiKey=${apiKey}&cntntsNo=${cntntsNo}`;
  const doc = parseXml(await getText(url));
  assertNongsaroOk(doc);
  const item = xmlItems(doc)[0] ?? {};
  const body = Object.values(item)
    .map((v) => String(v ?? ""))
    .sort((a, b) => b.length - a.length)[0] ?? "";
  return {
    text: htmlToText(body),
    url: `https://www.nongsaro.go.kr/portal/ps/psz/psza/contentSub.ps?menuId=PS00199&cntntsNo=${cntntsNo}`,
  };
}

// ── 비료 표준사용량 처방 (data.go.kr 1390802/SoilEnviron/FrtlzrStdUse) ──
export type FertilizerStandard = {
  code: string;
  name: string;
  preN: number | null;
  preP: number | null;
  preK: number | null;
  postN: number | null;
  postP: number | null;
  postK: number | null;
};

const FERT_URL = "https://apis.data.go.kr/1390802/SoilEnviron/FrtlzrStdUse/getSoilFrtlzrQyList";
export const FERT_SOURCE_URL = "https://www.data.go.kr/data/15075889/openapi.do";

const n = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));

// 작물코드는 분류 2자리 + 번호 3자리 (예: 01018 콩, 07005 배추). 코드표가 API로 제공되지 않아 순회한다.
// 텃밭 작물이 있는 분류만 본다: 01 맥류·두류·잡곡, 02 유지류, 03 서류, 04 과채, 05 근채, 06 양념채소, 07 엽채, 08 산채.
// (00 벼, 09 과수, 10 약용, 11 화훼, 12 사료, 13 특용은 제외.) 번호 앞쪽이 비기도 해서(04003부터 시작) 연속 30개가 비면 다음 분류로.
const FERT_CATEGORIES = ["01", "02", "03", "04", "05", "06", "07", "08"];

export async function listFertilizerStandards(serviceKey: string, maxSeq = 200): Promise<FertilizerStandard[]> {
  const out: FertilizerStandard[] = [];
  for (const category of FERT_CATEGORIES) {
    let emptyRun = 0;
    for (let seq = 1; seq <= maxSeq && emptyRun < 30; seq++) {
      const c = category + String(seq).padStart(3, "0");
      const std = await getFertilizerStandard(serviceKey, c);
      if (!std) {
        emptyRun++;
        continue;
      }
      emptyRun = 0;
      out.push(std);
    }
  }
  return out;
}

async function getFertilizerStandard(serviceKey: string, c: string): Promise<FertilizerStandard | null> {
  const url = `${FERT_URL}?serviceKey=${encodeURIComponent(serviceKey)}&fstd_Crop_Code=${c}`;
  const items = xmlItems(parseXml(await getText(url)));
  if (items.length === 0) return null;
  const i = items[0];
  return {
    code: c,
    name: String(i.fstd_Crop_Nm ?? ""),
    preN: n(i.pre_Fert_N),
    preP: n(i.pre_Fert_P),
    preK: n(i.pre_Fert_K),
    postN: n(i.post_Fert_N),
    postP: n(i.post_Fert_P),
    postK: n(i.post_Fert_K),
  };
}

// ── 농약안전사용지침 (psis.rda.go.kr/openApi/service.do) ──
export type PesticideUse = {
  pestName: string;
  ingredient: string;
  moaCode: string | null;
  formulation: string | null;
  dilution: string | null;
  safeDays: number | null;
  maxUses: number | null;
  productName: string;
};

const PSIS_URL = "http://psis.rda.go.kr/openApi/service.do";
export const PSIS_SOURCE_URL = "https://psis.rda.go.kr/psis/";

const firstInt = (v: unknown) => {
  const m = String(v ?? "").match(/\d+/);
  return m ? Number(m[0]) : null;
};

export async function listPesticideUses(apiKey: string, cropName: string): Promise<PesticideUse[]> {
  const out: PesticideUse[] = [];
  for (let start = 1; start <= 1000; start += 50) {
    const url =
      `${PSIS_URL}?apiKey=${apiKey}&serviceCode=SVC01&serviceType=AA001&displayCount=50` +
      `&startPoint=${start}&cropName=${encodeURIComponent(cropName)}`;
    const xml = await getText(url);
    if (/ERR_\d+/.test(xml)) throw new Error(`농약안전사용지침 API 오류: ${xml.match(/ERR_\d+/)![0]}`);
    const items = xmlItems(parseXml(xml));
    for (const i of items) {
      if (String(i.cropName ?? "").trim() !== cropName) continue;
      out.push({
        pestName: String(i.diseaseWeedName ?? "").trim(),
        ingredient: String(i.engName ?? i.pestiKorName ?? "").trim(),
        moaCode: String(i.indictSymbl ?? "").trim() || null,
        formulation: String(i.pestiUse ?? "").trim() || null,
        dilution: String(i.dilutUnit ?? "").trim() || null,
        safeDays: firstInt(i.useSuittime),
        maxUses: firstInt(i.useNum),
        productName: String(i.pestiBrandName ?? i.pestiKorName ?? "").trim(),
      });
    }
    if (items.length < 50) break;
  }
  return out;
}

