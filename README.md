# 주말텃밭

주말텃밭 계획·기록·알림 PWA. Next.js(App Router) + Supabase + Vercel Hobby. 운영 비용 0원.

기획 문서: `01_계획서.md`, 작업 지시: `02_지시서.md` (단계 P0~P10).

## 로컬 실행

```bash
npm install
cp .env.example .env.local   # 값 채우기
npm run dev
```

## 검사

```bash
npm test        # 마이그레이션 + RLS 테스트 (PGlite, Docker 불필요)
npm run lint
npm run build
```

## Supabase 설정 (신규 프로젝트)

1. supabase.com에서 **새 프로젝트** 생성 (기존 '허브' 프로젝트와 분리, Free 플랜, 리전 Seoul).
2. Project Settings > API에서 URL과 publishable key를 `.env.local`에 넣는다.
3. 마이그레이션 적용: SQL Editor에 `supabase/migrations/*.sql`을 파일명 순서대로 붙여넣고 실행.
   (또는 `npx supabase link --project-ref <ref>` 후 `npx supabase db push`)
4. Authentication > **Sign In / Providers** > User Signups
   - Allow new users to sign up: **켬**
   - Confirm email: **끔** (로그인은 이메일+비밀번호. 확인 메일 없이 가입 즉시 사용)
5. Authentication > URL Configuration > Site URL: Vercel 배포 주소.

## Vercel 배포

1. GitHub에 push 후 Vercel에서 Import (Hobby).
2. Environment Variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. 함수 리전은 `vercel.json`에서 `icn1`(서울)로 고정.

## 홈 화면 설치 (갤럭시 Chrome)

HTTPS 배포 주소에서 Chrome 메뉴 > **홈 화면에 추가** > 설치.

## PWA 아이콘

`public/icons/`는 `node scripts/gen-icons.mjs`로 생성한다.
# weekend-farm

## 작물 데이터 수집 (P2)

1. `.env.local`에 `SUPABASE_SERVICE_ROLE_KEY`, `NONGSARO_API_KEY`, `DATA_GO_KR_SERVICE_KEY`, `PSIS_API_KEY`를 넣는다 (`.env.example` 참고).
   service role 키는 로컬 수집에만 쓰고 Vercel·Git에 올리지 않는다.
2. `npm run collect` — 부록 A 85종 시드 → 텃밭가꾸기 원문 추출 → 비료 처방 → 농약안전사용지침 → 재해예방 문구.
   API 호출 사이에 0.7초 지연, 실패 시 3회 재시도 (`COLLECT_INTERVAL_MS`로 조정).
3. 결과는 모두 `draft`로 저장되고 `missing_report.md`가 생성된다.
4. 앱에서 `/admin/crops` → 필드별로 근거 원문을 보고 **추출값 승인** 또는 **직접 입력** → 모두 끝나면 **확정**.
   관리자가 없으면 이 화면에서 "첫 관리자로 등록하기"를 누른다 (최초 1명만).
   앱 일반 화면에는 확정된 작물만 보인다.
