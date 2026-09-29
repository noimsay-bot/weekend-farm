# 인수인계 (다른 컴퓨터에서 이어서 작업)

최종 갱신: 2026-09-30

## 현재 상태
- 지시서 P0~P10 코드 완료, `main`에 push, Vercel 배포됨 (https://weekend-farm.vercel.app).
- Supabase 마이그레이션 P0~P5 모두 적용됨.
- Vercel 환경변수(Production): Supabase URL·publishable key, service role key, VAPID 3개, CRON_SECRET.
- GitHub Actions secrets: `APP_URL`, `CRON_SECRET`.
- 일일 크론 수동 실행 200 확인. 기상청 키가 없어 날씨는 아직 건너뜀.

## 남은 일
1. API 키 발급 (사용자): 농사로 OpenAPI, 공공데이터포털(작물별 비료 표준사용량 처방, 기상청 단기예보·기상특보·ASOS 일자료), 농약안전정보시스템.
2. 키를 `.env.local`과 Vercel env에 추가: `NONGSARO_API_KEY`, `DATA_GO_KR_SERVICE_KEY`, `PSIS_API_KEY`(수집 스크립트 전용, Vercel 불필요) → 재배포.
3. `npm run collect` → `missing_report.md` 확인 → `/admin/crops`에서 작물 확정 (확정 작물이 없으면 계획에서 칠할 작물이 없음).
4. 남은 이슈 목록: `docs/final-review.md` 4장.

## 새 컴퓨터 설정
```bash
git clone https://github.com/noimsay-bot/weekend-farm.git
cd weekend-farm
npm install
npx vercel login
npx vercel link --yes --project weekend-farm
npx vercel env pull --environment=production .env.local
npm test
```
- `.env.local`은 Git에 없다 (공개 저장소). 위 `env pull`로 받거나 원래 컴퓨터에서 직접 옮긴다. API 키는 발급 후 추가.

## 작업 규칙 (사용자 결정)
- 수정이 끝나고 lint·test·build가 통과하면 묻지 말고 `main`에 커밋·push (Vercel 자동 배포).
- 로그인은 이메일+비밀번호 (Supabase Confirm email 끔). 지시서의 OTP 방식은 쓰지 않는다 — 기본 메일은 custom SMTP 없이 템플릿 수정 불가.
- 밭 격자는 스크롤 없이 한 화면에 보여야 한다 (`src/lib/grid-fit.ts`).
- 작물 재배 수치는 농사로 원문에서만. 모르는 값은 비워 두고 관리자가 입력.
- DB 변경은 `supabase/migrations`에 새 파일로 추가하고, `supabase/tests`(PGlite)로 RLS 테스트를 함께 쓴다. 적용은 Supabase SQL Editor.
