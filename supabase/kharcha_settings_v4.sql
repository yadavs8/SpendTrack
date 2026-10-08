-- Kharcha Book v4: run once in the Supabase SQL editor. Safe to run more than once.
--
-- One JSON settings row per user, shared by the web app (any browser) and the Android app:
-- trips and the active trip, trip friends and budgets, monthly/category budgets, merchant memory,
-- the owner's own name(s) for self-transfer detection, and UPI IDs for settle-up links.
-- Before this, all of it lived in each device's localStorage, so phone and desktop disagreed and a
-- reinstall wiped it.

create table if not exists public.kharcha_settings (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.kharcha_settings enable row level security;

drop policy if exists "read own kharcha settings" on public.kharcha_settings;
create policy "read own kharcha settings" on public.kharcha_settings
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "add own kharcha settings" on public.kharcha_settings;
create policy "add own kharcha settings" on public.kharcha_settings
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "edit own kharcha settings" on public.kharcha_settings;
create policy "edit own kharcha settings" on public.kharcha_settings
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
