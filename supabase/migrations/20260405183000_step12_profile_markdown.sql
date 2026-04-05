alter table if exists public.profiles
  add column if not exists profile_markdown text not null default '';

alter table if exists public.profiles
  add column if not exists profile_data jsonb not null default '{}'::jsonb;
