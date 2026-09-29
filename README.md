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
