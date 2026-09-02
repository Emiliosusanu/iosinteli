-- Device push tokens for APNs (and future FCM) remote notifications.
-- The iOS app upserts here on registerForPushAsync() with onConflict = token.
-- Idempotent: safe to run even if the table already exists in the linked project.

create table if not exists public.device_push_tokens (
  token       text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  platform    text,
  token_type  text,
  environment text not null default 'production',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Backfill columns if an older version of the table already existed.
alter table public.device_push_tokens add column if not exists platform    text;
alter table public.device_push_tokens add column if not exists token_type  text;
alter table public.device_push_tokens add column if not exists environment text not null default 'production';
alter table public.device_push_tokens add column if not exists created_at  timestamptz not null default now();
alter table public.device_push_tokens add column if not exists updated_at  timestamptz not null default now();

create index if not exists device_push_tokens_user_id_idx
  on public.device_push_tokens (user_id);

alter table public.device_push_tokens enable row level security;

-- Users manage only their own tokens. The Edge Function uses the service role
-- (which bypasses RLS) to read every token when sending a push.
drop policy if exists "device tokens: select own"  on public.device_push_tokens;
drop policy if exists "device tokens: insert own"  on public.device_push_tokens;
drop policy if exists "device tokens: update own"  on public.device_push_tokens;
drop policy if exists "device tokens: delete own"  on public.device_push_tokens;

create policy "device tokens: select own"
  on public.device_push_tokens for select
  using (auth.uid() = user_id);

create policy "device tokens: insert own"
  on public.device_push_tokens for insert
  with check (auth.uid() = user_id);

create policy "device tokens: update own"
  on public.device_push_tokens for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "device tokens: delete own"
  on public.device_push_tokens for delete
  using (auth.uid() = user_id);
