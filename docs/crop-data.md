# 작물 백과사전 자료 만들기

2026-10-01부터 작물 재배 자료는 공공 API 대신, 지정한 작물을 하나씩 조사해 `data/crops/<작물>.json`으로 만들고 DB에 넣는다 (사용자 결정 — 혼자 쓰는 앱).

## 출처 규칙
- 모든 수치에 출처(`refs`)가 있어야 한다. 출처 없는 수치는 넣지 않고 `value: null` + `evidence`에 이유를 적는다 (앱에서 '모름').
- 핵심 수치(`KEY_FIELDS`: 수확까지 일수, 포기·줄 간격, 최저·최고기온, 육묘일수)는 출처 2곳 이상.
- 출처끼리 다르면 `evidence`에 차이를 적고 `confidence`를 낮춘다.
- 다른 작물의 자료를 빌려 쓰지 않는다 (봄동 ≠ 배추).
- 우선 출처: 농사로(텃밭가꾸기), 농촌진흥청 웹진·국립원예특작과학원·국립식량과학원, 시·군 농업기술센터.
- 유튜브: **광닭이**, **농사친구** 채널을 중심으로 찾는다 (사용자 지정). 자막을 읽고 요약만 적는다(원문 옮기지 않음). 제품 홍보가 있으면 요약에 표시하고, 홍보 수치는 근거로 쓰지 않는다.
- 이미지: 가지치기가 필요한 작물만 가지치기 그림을 만든다 (`crop_media`).

## 절차
1. 조사 도구
   ```bash
   npm run crops:research -- nongsaro 배추        # 농사로 텃밭가꾸기 원문
   npm run crops:research -- videos 배추          # 광닭이·농사친구 채널 검색
   npm run crops:research -- transcript <영상ID>  # 자동 자막
   ```
   웹 자료는 Claude Code의 웹 검색으로 찾는다.
2. `data/crops/<작물>.json` 작성 (형식: `scripts/crops/schema.ts`, 예시: `data/crops/배추.json`).
3. `npm run crops:check` (테스트에도 포함).
4. `npm run crops:import -- <작물>` → `/admin/crops`에서 확인 후 승인.

## 앱 반영 방식
- 재배 수치 → `crops` 칸 (일정·배지·경고 계산에 그대로 쓰임). `min_temp_c`/`max_temp_c`는 생육 적온이 아니라 **정식(파종) 적합일 판정** 기준이다.
- 필드별 근거·신뢰도 → `crop_field_sources` (`origin = ai_research`).
- 관행 시기 → `crop_regional_calendars` (지역: 중부·남부·제주·전국).
- 비료: N·P·K 성분량은 공공데이터 처방값을 유지하고, 퇴비·석회·웃거름 시기만 자료로 채운다.
- 본문 → `crop_guides`, 참고자료·영상 → `crop_references`.
- 관리자가 직접 입력한 필드는 다시 넣어도 덮어쓰지 않는다.

## 진행 현황
- 1차 목록: 배추, 무, 쪽파, 고수, 이탈리안 파슬리, 청경채, 대파, 돌산갓, 냉이, 봄동, 월동시금치
- 완료: 배추, 무, 쪽파
