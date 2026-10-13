-- Kharcha Book: Shared Trips (v1). Run once in the Supabase SQL editor (Dashboard > SQL Editor
-- > New query). Safe to run more than once. Additive only -- daily_expenses and kharcha_settings
-- are never touched, and their RLS is not weakened in any way.
--
-- A friend invited via a WhatsApp link has NO Supabase account and never signs in. Every bit of
-- access for them goes through the three functions marked "guest-facing" below (trip_join,
-- trip_summary, trip_add_expense). Those run as SECURITY DEFINER (elevated rights) and validate
-- the caller's token themselves before touching anything -- the tables stay locked to the trip's
-- owner; a guest never gets a direct key to them. Everything else here (trip_get_or_create,
-- trip_set_invite, trip_add_owner_expense) runs as the signed-in owner, same as every other
-- table in this app.

create extension if not exists pgcrypto; -- gen_random_bytes, for unguessable tokens

create table if not exists public.trips (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 60),
  invite_token   text unique,
  invite_enabled boolean not null default true,
  created_at     timestamptz not null default now()
);

create table if not exists public.trip_members (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  guest_token  text not null unique,
  created_at   timestamptz not null default now()
);

-- A real shared ledger, separate from daily_expenses on purpose: your personal finance data
-- (every bank payment, every category) stays exactly as private as it is today no matter what
-- happens here. member_id is null when the owner themself added the row.
create table if not exists public.trip_expenses (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.trips (id) on delete cascade,
  member_id     uuid references public.trip_members (id) on delete set null,
  added_by_name text not null check (char_length(added_by_name) between 1 and 40),
  amount        numeric(12,2) not null check (amount > 0),
  description   text not null check (char_length(description) between 1 and 80),
  spent_at      timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists trip_expenses_trip_idx on public.trip_expenses (trip_id, spent_at desc);
create index if not exists trip_members_trip_idx on public.trip_members (trip_id);

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_expenses enable row level security;

-- Direct table access is owner-only. A guest never queries these tables themselves -- only the
-- guest-facing functions below do, and those run with elevated rights that bypass RLS entirely,
-- which is exactly why they validate the invite/guest token in their own body instead.
drop policy if exists "owner reads own trips" on public.trips;
create policy "owner reads own trips" on public.trips
  for select to authenticated using (auth.uid() = owner_user_id);
drop policy if exists "owner creates own trips" on public.trips;
create policy "owner creates own trips" on public.trips
  for insert to authenticated with check (auth.uid() = owner_user_id);
drop policy if exists "owner updates own trips" on public.trips;
create policy "owner updates own trips" on public.trips
  for update to authenticated using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

drop policy if exists "owner reads own trip members" on public.trip_members;
create policy "owner reads own trip members" on public.trip_members
  for select to authenticated using (
    exists (select 1 from public.trips t where t.id = trip_id and t.owner_user_id = auth.uid())
  );

drop policy if exists "owner reads own trip expenses" on public.trip_expenses;
create policy "owner reads own trip expenses" on public.trip_expenses
  for select to authenticated using (
    exists (select 1 from public.trips t where t.id = trip_id and t.owner_user_id = auth.uid())
  );
drop policy if exists "owner adds own trip expenses" on public.trip_expenses;
create policy "owner adds own trip expenses" on public.trip_expenses
  for insert to authenticated with check (
    exists (select 1 from public.trips t where t.id = trip_id and t.owner_user_id = auth.uid())
  );

-- ========== Owner-side (runs as the signed-in user; relies on the RLS above) ==========

-- Finds the trip by name for this owner, or creates it. Phase 2 (web UI) calls this the first
-- time you tap "Invite via WhatsApp" on an existing trip name.
create or replace function public.trip_get_or_create(p_name text)
returns public.trips
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_trip public.trips;
begin
  select * into v_trip from public.trips where owner_user_id = auth.uid() and name = p_name limit 1;
  if v_trip.id is null then
    insert into public.trips (owner_user_id, name) values (auth.uid(), p_name) returning * into v_trip;
  end if;
  return v_trip;
end;
$$;

-- Turns the invite link on/off, or regenerates it (kills the old link immediately -- anyone
-- still holding it gets "this trip link is not active" from the guest-facing functions below).
create or replace function public.trip_set_invite(p_trip_id uuid, p_enabled boolean, p_regenerate boolean default false)
returns public.trips
language plpgsql
security invoker
set search_path = public, extensions -- gen_random_bytes lives in "extensions" on Supabase, not public
as $$
declare
  v_trip public.trips;
begin
  update public.trips
    set invite_enabled = p_enabled,
        invite_token = case
          when p_regenerate or invite_token is null then encode(gen_random_bytes(18), 'hex')
          else invite_token
        end
    where id = p_trip_id and owner_user_id = auth.uid()
    returning * into v_trip;
  if v_trip.id is null then
    raise exception 'Trip not found or not yours';
  end if;
  return v_trip;
end;
$$;

-- The owner's own entries into the shared ledger (web "Trip" scope, and the phone's
-- auto-file-to-active-trip). A normal RLS-checked insert, nothing elevated. p_added_by_name
-- comes from the app's own "Your details" setting -- not from auth.users, which the
-- authenticated role can't read directly in Supabase by default.
create or replace function public.trip_add_owner_expense(
  p_trip_id uuid, p_added_by_name text, p_amount numeric, p_description text, p_spent_at timestamptz default now()
)
returns public.trip_expenses
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_expense public.trip_expenses;
begin
  insert into public.trip_expenses (trip_id, member_id, added_by_name, amount, description, spent_at)
    values (p_trip_id, null, coalesce(trim(p_added_by_name), 'Me'), p_amount, p_description, coalesce(p_spent_at, now()))
    returning * into v_expense;
  return v_expense;
end;
$$;

-- ========== Guest-facing (SECURITY DEFINER: the only way a token-holding, non-signed-in
-- friend ever touches this data; each one re-derives the trip from the token itself, never
-- trusts a client-supplied trip id) ==========

-- First visit: creates the trip_members row and hands back a guest_token to save in their
-- browser. Return visit: pass that same guest_token back and it recognizes them, skipping the
-- name prompt.
create or replace function public.trip_join(p_invite_token text, p_display_name text, p_existing_guest_token text default null)
returns table (trip_id uuid, trip_name text, member_id uuid, guest_token text, display_name text)
language plpgsql
security definer
set search_path = public, extensions -- gen_random_bytes lives in "extensions" on Supabase, not public
as $$
declare
  v_trip public.trips;
  v_member public.trip_members;
begin
  select * into v_trip from public.trips where invite_token = p_invite_token and invite_enabled limit 1;
  if v_trip.id is null then
    raise exception 'This trip link is not active.';
  end if;

  if p_existing_guest_token is not null then
    select * into v_member from public.trip_members
      where guest_token = p_existing_guest_token and trip_id = v_trip.id limit 1;
  end if;

  if v_member.id is null then
    if p_display_name is null or length(trim(p_display_name)) = 0 then
      raise exception 'A name is required to join.';
    end if;
    insert into public.trip_members (trip_id, display_name, guest_token)
      values (v_trip.id, trim(p_display_name), encode(gen_random_bytes(18), 'hex'))
      returning * into v_member;
  end if;

  return query select v_trip.id, v_trip.name, v_member.id, v_member.guest_token, v_member.display_name;
end;
$$;

-- Running total + the list, for the guest page (and the owner's own page, same shape).
create or replace function public.trip_summary(p_invite_token text)
returns table (trip_name text, total numeric, expense_count bigint, expenses jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip public.trips;
begin
  select * into v_trip from public.trips where invite_token = p_invite_token and invite_enabled limit 1;
  if v_trip.id is null then
    raise exception 'This trip link is not active.';
  end if;

  return query
    select v_trip.name,
           coalesce(sum(e.amount), 0),
           count(e.id),
           coalesce(jsonb_agg(jsonb_build_object(
             'amount', e.amount, 'description', e.description,
             'added_by_name', e.added_by_name, 'spent_at', e.spent_at
           ) order by e.spent_at desc), '[]'::jsonb)
    from public.trip_expenses e where e.trip_id = v_trip.id;
end;
$$;

-- A guest logging their own spend. Both tokens must agree on the same trip before anything is
-- written -- a stale or mismatched guest_token fails closed, not open.
create or replace function public.trip_add_expense(
  p_invite_token text, p_guest_token text, p_amount numeric, p_description text, p_spent_at timestamptz default now()
)
returns public.trip_expenses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip public.trips;
  v_member public.trip_members;
  v_expense public.trip_expenses;
begin
  select * into v_trip from public.trips where invite_token = p_invite_token and invite_enabled limit 1;
  if v_trip.id is null then
    raise exception 'This trip link is not active.';
  end if;
  select * into v_member from public.trip_members where guest_token = p_guest_token and trip_id = v_trip.id limit 1;
  if v_member.id is null then
    raise exception 'Join the trip first.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;
  if p_description is null or length(trim(p_description)) = 0 then
    raise exception 'Add a description.';
  end if;

  insert into public.trip_expenses (trip_id, member_id, added_by_name, amount, description, spent_at)
    values (v_trip.id, v_member.id, v_member.display_name, p_amount, trim(p_description), coalesce(p_spent_at, now()))
    returning * into v_expense;
  return v_expense;
end;
$$;

-- Postgres revokes execute from new functions by default; grant exactly what each side needs.
-- The guest-facing three are granted to both roles: a friend's browser calls them as "anon" (no
-- Supabase session at all), but the owner previewing their own invite link while still signed in
-- calls the same functions as "authenticated" -- either way, the token check inside each one is
-- what actually decides access, not the role.
grant execute on function public.trip_join(text, text, text) to anon, authenticated;
grant execute on function public.trip_summary(text) to anon, authenticated;
grant execute on function public.trip_add_expense(text, text, numeric, text, timestamptz) to anon, authenticated;

grant execute on function public.trip_get_or_create(text) to authenticated;
grant execute on function public.trip_set_invite(uuid, boolean, boolean) to authenticated;
grant execute on function public.trip_add_owner_expense(uuid, text, numeric, text, timestamptz) to authenticated;
