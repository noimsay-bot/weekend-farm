-- P0: 농장, 멤버, 초대 링크
-- Supabase는 pgcrypto를 extensions 스키마에 설치한다.
create extension if not exists pgcrypto with schema extensions;

create type public.farm_role as enum ('owner', 'member');

-- 온보딩 진행 단계 (계획서 M0). done이면 온보딩 완료.
create type public.onboarding_step as enum ('field', 'planted', 'invite', 'done');

create table public.farms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 50),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  width_m numeric(6, 2) not null check (width_m > 0 and width_m <= 1000),
  height_m numeric(6, 2) not null check (height_m > 0 and height_m <= 1000),
  onboarding_step public.onboarding_step not null default 'field',
  -- 온보딩 "지금 심어진 작물이 있나요?" 답. 온보딩 종료 후 이동할 계획 화면을 정한다.
  onboarding_has_planted boolean,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.farm_members (
  farm_id uuid not null references public.farms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.farm_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (farm_id, user_id)
);

create index farm_members_user_id_idx on public.farm_members (user_id);

-- 원본 토큰은 저장하지 않고 sha256 해시만 저장한다.
create table public.farm_invites (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users (id),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create index farm_invites_farm_id_idx on public.farm_invites (farm_id);

-- RLS 정책에서 farm_members를 직접 조회하면 재귀가 생기므로 security definer 헬퍼를 쓴다.
create function public.is_farm_member(p_farm_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.farm_members
    where farm_id = p_farm_id and user_id = auth.uid()
  );
$$;

alter table public.farms enable row level security;
alter table public.farm_members enable row level security;
alter table public.farm_invites enable row level security;

create policy farms_select on public.farms
  for select to authenticated
  using (public.is_farm_member(id));

create policy farms_update on public.farms
  for update to authenticated
  using (public.is_farm_member(id))
  with check (public.is_farm_member(id));

create policy farm_members_select on public.farm_members
  for select to authenticated
  using (public.is_farm_member(farm_id));

create policy farm_invites_select on public.farm_invites
  for select to authenticated
  using (public.is_farm_member(farm_id));

-- 농장 생성과 owner 등록을 한 트랜잭션으로 처리한다.
-- (farm_members에 insert 정책이 없으므로 직접 insert는 차단된다)
create function public.create_farm(
  p_name text,
  p_lat double precision,
  p_lng double precision,
  p_width_m numeric,
  p_height_m numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_farm_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into public.farms (name, lat, lng, width_m, height_m, created_by)
  values (p_name, p_lat, p_lng, p_width_m, p_height_m, auth.uid())
  returning id into v_farm_id;

  insert into public.farm_members (farm_id, user_id, role)
  values (v_farm_id, auth.uid(), 'owner');

  return v_farm_id;
end;
$$;

-- 초대 링크 생성. 원본 토큰은 이 함수의 반환값으로만 한 번 노출된다.
create function public.create_farm_invite(p_farm_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not public.is_farm_member(p_farm_id) then
    raise exception 'not a farm member' using errcode = '42501';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into public.farm_invites (farm_id, token_hash, expires_at, created_by)
  values (
    p_farm_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    now() + interval '72 hours',
    auth.uid()
  );

  return v_token;
end;
$$;

-- 초대 수락. 만료·1회 사용을 검사하고 멤버로 추가한다.
-- 이미 멤버면 초대를 소모하지 않고 농장 id만 돌려준다.
create function public.accept_farm_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.farm_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_invite
  from public.farm_invites
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;

  if not found then
    raise exception 'invite_not_found' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.farm_members
    where farm_id = v_invite.farm_id and user_id = auth.uid()
  ) then
    return v_invite.farm_id;
  end if;

  if v_invite.used_at is not null then
    raise exception 'invite_used' using errcode = 'P0001';
  end if;

  if v_invite.expires_at < now() then
    raise exception 'invite_expired' using errcode = 'P0001';
  end if;

  update public.farm_invites
  set used_at = now(), used_by = auth.uid()
  where id = v_invite.id;

  insert into public.farm_members (farm_id, user_id, role)
  values (v_invite.farm_id, auth.uid(), 'member');

  return v_invite.farm_id;
end;
$$;

revoke execute on function public.create_farm(text, double precision, double precision, numeric, numeric) from public, anon;
revoke execute on function public.create_farm_invite(uuid) from public, anon;
revoke execute on function public.accept_farm_invite(text) from public, anon;
revoke execute on function public.is_farm_member(uuid) from public, anon;
grant execute on function public.create_farm(text, double precision, double precision, numeric, numeric) to authenticated;
grant execute on function public.create_farm_invite(uuid) to authenticated;
grant execute on function public.accept_farm_invite(text) to authenticated;
grant execute on function public.is_farm_member(uuid) to authenticated;
