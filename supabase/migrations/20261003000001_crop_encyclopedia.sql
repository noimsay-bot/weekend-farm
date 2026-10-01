-- 작물 백과사전: 작물별 조사 자료(data/crops/*.json)를 그대로 담는다.
-- 재배 수치는 기존 crops 칸에 넣고(일정·경고 계산용), 본문·참고자료·이미지는 아래 테이블에 둔다.
-- 출처 규칙: 모든 수치는 출처 링크가 있어야 하고, 핵심 수치는 출처 2곳 이상에서 확인한다.

alter table public.crops add column category text;          -- 잎채소, 뿌리채소, 양념채소, 허브 …

-- 필드별 근거: 신뢰도와 근거 자료 키를 함께 남긴다
alter table public.crop_field_sources
  add column origin text not null default 'nongsaro' check (origin in ('nongsaro', 'ai_research', 'manual')),
  add column confidence text check (confidence in ('high', 'medium', 'low')),
  add column ref_keys text[];

alter table public.crop_varieties drop constraint crop_varieties_value_source_check;
alter table public.crop_varieties
  add constraint crop_varieties_value_source_check check (value_source in ('user', 'nongsaro', 'ai_research'));

-- 참고 자료 (문서·영상). ref_key는 JSON 안에서 필드 근거가 가리키는 키 (예: r1)
create table public.crop_references (
  id uuid primary key default gen_random_uuid(),
  crop_id uuid not null references public.crops (id) on delete cascade,
  ref_key text not null,
  kind text not null check (kind in ('doc', 'video')),
  title text not null,
  url text not null,
  publisher text,
  summary text,                            -- 영상은 내용 요약 (원문을 옮기지 않는다)
  sort int not null default 0,
  unique (crop_id, ref_key)
);

-- 백과사전 본문 (섹션별 마크다운)
create table public.crop_guides (
  id uuid primary key default gen_random_uuid(),
  crop_id uuid not null references public.crops (id) on delete cascade,
  section text not null,                   -- 소개, 밭 준비, 파종·정식, 관리, 병해충, 수확, 보관, 자주 하는 실수
  body text not null,
  ref_keys text[],
  sort int not null default 0,
  unique (crop_id, section)
);

-- 이미지 (현재는 가지치기 그림만)
create table public.crop_media (
  id uuid primary key default gen_random_uuid(),
  crop_id uuid not null references public.crops (id) on delete cascade,
  kind text not null check (kind in ('pruning')),
  url text not null,
  caption text,
  ai_generated boolean not null default true,
  sort int not null default 0
);

-- 작물 계열 테이블과 같은 규칙: 읽기는 모두(draft는 관리자만), 쓰기는 관리자만
alter table public.crop_references enable row level security;
alter table public.crop_guides enable row level security;
alter table public.crop_media enable row level security;

create policy crop_references_read on public.crop_references for select to authenticated
  using (exists (select 1 from public.crops c where c.id = crop_id and (c.status = 'confirmed' or public.is_app_admin())));
create policy crop_references_admin on public.crop_references for all to authenticated
  using (public.is_app_admin()) with check (public.is_app_admin());

create policy crop_guides_read on public.crop_guides for select to authenticated
  using (exists (select 1 from public.crops c where c.id = crop_id and (c.status = 'confirmed' or public.is_app_admin())));
create policy crop_guides_admin on public.crop_guides for all to authenticated
  using (public.is_app_admin()) with check (public.is_app_admin());

create policy crop_media_read on public.crop_media for select to authenticated
  using (exists (select 1 from public.crops c where c.id = crop_id and (c.status = 'confirmed' or public.is_app_admin())));
create policy crop_media_admin on public.crop_media for all to authenticated
  using (public.is_app_admin()) with check (public.is_app_admin());
