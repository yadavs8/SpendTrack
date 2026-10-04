-- Kharcha Book: run once in the Supabase SQL editor (Dashboard > SQL Editor > New query).
-- Creates a new, private expenses table. Existing tables are not touched.
-- Each signed-in user can only see and change their own rows.

create table if not exists public.daily_expenses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  amount      numeric(12,2) not null check (amount > 0),
  description text not null check (char_length(description) between 1 and 60),
  spent_at    timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists daily_expenses_user_time_idx
  on public.daily_expenses (user_id, spent_at desc);

alter table public.daily_expenses enable row level security;

drop policy if exists "read own expenses" on public.daily_expenses;
create policy "read own expenses" on public.daily_expenses
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "add own expenses" on public.daily_expenses;
create policy "add own expenses" on public.daily_expenses
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "edit own expenses" on public.daily_expenses;
create policy "edit own expenses" on public.daily_expenses
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own expenses" on public.daily_expenses;
create policy "delete own expenses" on public.daily_expenses
  for delete to authenticated using (auth.uid() = user_id);
