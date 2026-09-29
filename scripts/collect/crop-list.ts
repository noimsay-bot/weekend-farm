// 계획서 부록 A 확정 목록 (85종). 품종·태그 이름만 담는다 (재배 수치 없음).
// aliases: 농사로 텃밭가꾸기 글 제목과 맞추기 위한 다른 이름.

export type CropSeed = {
  name: string;
  varieties?: string[];
  tags?: string[];
  aliases?: string[];
};

const SSAM = "쌈채소";
const KIMJANG = "김장채소";
const SUMMER = "여름 고온기 작물";
const HERB = "허브";

export const CROP_SEEDS: CropSeed[] = [
  // 열매·덩굴
  { name: "고추", varieties: ["청양고추", "오이고추", "꽈리고추", "태국고추", "베트남고추"] },
  { name: "토마토", varieties: ["토마토", "방울토마토"] },
  { name: "가지" },
  { name: "오이" },
  { name: "애호박", aliases: ["호박"] },
  { name: "단호박", aliases: ["호박"] },
  { name: "늙은호박(맷돌호박)", aliases: ["호박"] },
  { name: "수박", varieties: ["수박", "애플수박", "복수박"] },
  { name: "참외" },
  { name: "옥수수" },
  { name: "파프리카·피망", aliases: ["파프리카", "피망"] },
  { name: "딸기", aliases: ["딸기 텃밭가꾸기"] },
  { name: "땅콩" },
  { name: "수세미", aliases: ["수세미오이"] },
  // 콩·깨
  { name: "완두" },
  { name: "강낭콩" },
  { name: "그린빈" },
  { name: "콩(메주콩·서리태)", aliases: ["콩"] },
  { name: "팥" },
  { name: "참깨" },
  // 잎채소
  { name: "상추", tags: [SSAM] },
  { name: "양상추" },
  { name: "쑥갓", tags: [SSAM] },
  { name: "깻잎(들깨)", tags: [SSAM], aliases: ["잎들깨", "들깨", "깻잎"] },
  { name: "케일", tags: [SSAM] },
  { name: "근대" },
  { name: "아욱" },
  { name: "치커리", tags: [SSAM] },
  { name: "다채(비타민)", tags: [SSAM], aliases: ["다채", "비타민"] },
  { name: "루꼴라", tags: [SSAM] },
  { name: "궁채(줄기상추)", aliases: ["궁채", "줄기상추"] },
  { name: "경수채(미즈나)", aliases: ["경수채", "미즈나"] },
  // 배추·무·꽃채소
  { name: "무", tags: [KIMJANG] },
  { name: "배추", tags: [KIMJANG] },
  { name: "양배추", varieties: ["양배추", "적양배추", "방울양배추"] },
  { name: "돌산갓", tags: [KIMJANG] },
  { name: "갓", tags: [KIMJANG] },
  { name: "청경채" },
  { name: "채심(초이섬)", aliases: ["채심", "초이섬"] },
  { name: "카이란" },
  { name: "알타리무", tags: [KIMJANG] },
  { name: "열무" },
  { name: "얼갈이배추" },
  { name: "브로콜리" },
  { name: "콜리플라워" },
  { name: "콜라비" },
  // 뿌리·덩이
  { name: "감자", aliases: ["감자 텃밭가꾸기"] },
  { name: "고구마" },
  { name: "당근" },
  { name: "비트" },
  { name: "적환무(래디시)", aliases: ["적환무", "래디시"] },
  { name: "우엉" },
  { name: "생강" },
  { name: "토란" },
  { name: "야콘" },
  { name: "마" },
  { name: "파스닙" },
  // 파·월동
  { name: "대파", tags: [KIMJANG], aliases: ["파"] },
  { name: "쪽파", tags: [KIMJANG] },
  { name: "부추" },
  { name: "봄동" },
  { name: "시금치" },
  { name: "마늘" },
  { name: "양파" },
  { name: "냉이" },
  // 여러해살이
  { name: "아스파라거스" },
  { name: "머위" },
  // 허브
  { name: "고수", tags: [HERB] },
  { name: "파슬리", tags: [HERB] },
  { name: "바질", tags: [HERB], varieties: ["스위트바질", "타이바질"] },
  { name: "민트", tags: [HERB], aliases: ["스피아민트"] },
  { name: "타임", tags: [HERB] },
  { name: "로즈마리", tags: [HERB] },
  { name: "차이브", tags: [HERB] },
  // 여름 고온기 작물
  { name: "공심채", tags: [SUMMER] },
  { name: "줄콩(롱빈)", tags: [SUMMER], aliases: ["줄콩", "롱빈"] },
  { name: "오크라", tags: [SUMMER] },
  { name: "여주", tags: [SUMMER] },
  { name: "차요테", tags: [SUMMER] },
  { name: "레몬그라스", tags: [SUMMER] },
  { name: "강황", tags: [SUMMER] },
  { name: "몰로키아", tags: [SUMMER] },
  { name: "아마란스", tags: [SUMMER] },
  { name: "날개콩", tags: [SUMMER] },
  { name: "히카마", tags: [SUMMER] },
];

// 농사로 글 제목을 작물에 대응시킨다. 한 글이 여러 작물(호박)에 쓰일 수 있다.
export function cropsForTitle(title: string): CropSeed[] {
  const t = title.replace(/\s+/g, " ").trim();
  return CROP_SEEDS.filter((c) => c.name === t || c.aliases?.includes(t));
}
