alter table if exists public.session_runs
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_session_runs_user_id_started_at
  on public.session_runs (user_id, started_at desc);
