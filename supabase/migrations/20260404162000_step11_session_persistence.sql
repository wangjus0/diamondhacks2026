create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.session_runs (
  session_id text primary key,
  started_at timestamptz not null default timezone('utc', now()),
  ended_at timestamptz,
  status text not null default 'active' check (status in ('active', 'completed', 'interrupted', 'errored', 'disconnected')),
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists set_session_runs_updated_at on public.session_runs;
create trigger set_session_runs_updated_at
before update on public.session_runs
for each row
execute function public.set_updated_at();

create table if not exists public.session_transcripts (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.session_runs(session_id) on delete cascade,
  text text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.session_action_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.session_runs(session_id) on delete cascade,
  status text not null,
  step text not null,
  detail text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.session_narration_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.session_runs(session_id) on delete cascade,
  text text not null,
  sequence integer,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_session_transcripts_session_id_created_at
  on public.session_transcripts (session_id, created_at);

create index if not exists idx_session_action_events_session_id_created_at
  on public.session_action_events (session_id, created_at);

create index if not exists idx_session_narration_events_session_id_created_at
  on public.session_narration_events (session_id, created_at);
