-- ════════════════════════════════════════════════════════════════
--  SNS Automation — Supabase 스키마
--  Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.
--  (혼자 쓰는 앱 — 단일 사용자. RLS는 "본인 데이터만" 규칙 하나로 단순화)
-- ════════════════════════════════════════════════════════════════

-- 플랫폼 종류
do $$ begin
  create type platform as enum ('youtube', 'instagram', 'tiktok');
exception when duplicate_object then null; end $$;

-- 발행 상태
do $$ begin
  create type target_status as enum ('pending', 'uploading', 'scheduled', 'published', 'failed');
exception when duplicate_object then null; end $$;

-- ───────── 연결된 플랫폼 계정 (내 계정만) ─────────
create table if not exists platform_connections (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  platform            platform not null,
  -- 토큰은 앱에서 암호화(AES-256-GCM)해 문자열로 저장
  access_token_enc    text not null,
  refresh_token_enc   text,
  token_expires_at    timestamptz,
  external_account_id text,               -- 예: IG business user id, YT channel id, TikTok open_id
  account_name        text,               -- 표시용 이름/핸들
  meta                jsonb default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (user_id, platform)
);

-- ───────── 업로드한 원본 영상 1건 ─────────
create table if not exists posts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  storage_path   text not null,           -- Storage 버킷 내 경로
  thumbnail_path text,
  duration_sec   numeric,
  created_at     timestamptz not null default now()
);

-- ───────── 플랫폼별 발행 계획 (posts 1 : N targets) ─────────
create table if not exists post_targets (
  id               uuid primary key default gen_random_uuid(),
  post_id          uuid not null references posts(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  platform         platform not null,
  title            text,                  -- 유튜브 제목
  caption          text,                  -- 플랫폼별 캡션/설명
  tags             text[] default '{}',   -- 유튜브 태그(선택)
  first_comment    text,                  -- 자동 첫 댓글 (유튜브 등)
  scheduled_at     timestamptz not null,  -- 예약 시각(UTC)
  status           target_status not null default 'pending',
  external_post_id text,                  -- 발행 후 반환된 플랫폼 게시물 ID
  ig_container_id  text,                  -- 인스타 컨테이너 폴링용
  error_message    text,
  attempts         int not null default 0,
  locked_at        timestamptz,           -- cron 중복 실행 방지 락
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_post_targets_due
  on post_targets (status, scheduled_at)
  where status in ('pending', 'failed');

-- updated_at 자동 갱신
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;

drop trigger if exists trg_conn_updated on platform_connections;
create trigger trg_conn_updated before update on platform_connections
  for each row execute function set_updated_at();

drop trigger if exists trg_target_updated on post_targets;
create trigger trg_target_updated before update on post_targets
  for each row execute function set_updated_at();

-- ───────── RLS: 본인 데이터만 ─────────
alter table platform_connections enable row level security;
alter table posts                enable row level security;
alter table post_targets         enable row level security;

do $$ begin
  create policy "own connections" on platform_connections
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "own posts" on posts
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "own targets" on post_targets
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- ════════════════════════════════════════════════════════════════
--  Storage 버킷: 아래를 SQL로 만들거나, 대시보드 Storage 에서 'videos' 버킷 생성
-- ════════════════════════════════════════════════════════════════
-- file_size_limit: 무료는 50MB(52428800) 상한. Pro + 대시보드 Storage 설정의
-- "글로벌 업로드 한도"를 올려야 아래 큰 값이 적용됨. (현재 2GB)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('videos', 'videos', false, 2147483648, array['video/*'])
  on conflict (id) do update
    set file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

-- 본인 폴더(user_id/...)만 접근
do $$ begin
  create policy "own video objects" on storage.objects
    for all
    using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text)
    with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
