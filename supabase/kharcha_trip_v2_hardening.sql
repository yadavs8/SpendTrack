-- Kharcha Book: trip sharing, hardened (audit H2 / M4 / Low, .rea/audit.md).
-- Why: on the guest trip page, "Pay via UPI" could be prefilled with someone else's UPI ID — the owner's ID
--      came from the link (?u=), member IDs were matched by display name, and a guest could join as "me" or
--      as the owner's name (which the page treats as the owner). Also: the UPI format check was loose,
--      split lists unbounded, and the scripts relied on a wrong comment about default grants.
-- What:
--   1. trips.owner_name / trips.owner_upi — set by the owner's app (RLS: owner-only update). The trip page
--      reads the owner's UPI from here, never from the link.
--   2. trip_join: refuses "me", the owner's name, and a name already taken in the trip (new joins only;
--      existing rows are untouched); at most 60 members per trip.
--   3. trip_set_my_upi: strict UPI format (name@bank).
--   4. trip_member_upis: also returns member_id and the owner's row (is_owner).
--   5. trip_add_expense: same rules as live (NaN / huge amounts refused, allow_guest_adds) plus a bounded
--      split list and a sane date.
--   6. Explicit revokes: guest functions for anon+authenticated, owner functions for authenticated only.
-- How: paste into the studio5-portal SQL editor; safe to run again. Additive: no row is changed or deleted.
-- Rollback: drop the two columns; re-run kharcha_trip_sharing_v1.sql + fix_trip_add_expense.sql.
begin;

alter table public.trips add column if not exists owner_name text;
alter table public.trips add column if not exists owner_upi text;
alter table public.trips drop constraint if exists trips_owner_name_check;
alter table public.trips add constraint trips_owner_name_check check (owner_name is null or char_length(btrim(owner_name)) between 1 and 40);
alter table public.trips drop constraint if exists trips_owner_upi_check;
alter table public.trips add constraint trips_owner_upi_check check (owner_upi is null or owner_upi ~* '^[a-z0-9._-]{2,64}@[a-z][a-z0-9.-]{1,30}$');

-- New member UPI IDs must look like name@bank (existing rows are not re-checked).
alter table public.trip_members drop constraint if exists trip_members_upi_format;
alter table public.trip_members add constraint trip_members_upi_format check (upi is null or upi ~* '^[a-z0-9._-]{2,64}@[a-z][a-z0-9.-]{1,30}$') not valid;

create or replace function public.trip_join(p_invite_token text, p_display_name text, p_existing_guest_token text default null)
returns table(trip_id uuid, trip_name text, member_id uuid, guest_token text, display_name text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_trip public.trips;
  v_member public.trip_members;
  v_name text := btrim(coalesce(p_display_name, ''));
  v_low text := lower(btrim(coalesce(p_display_name, '')));
begin
  select * into v_trip from public.trips where invite_token = p_invite_token and invite_enabled limit 1;
  if v_trip.id is null then raise exception 'This trip link is not active.'; end if;

  if p_existing_guest_token is not null then
    select * into v_member from public.trip_members m
      where m.guest_token = p_existing_guest_token and m.trip_id = v_trip.id limit 1;
  end if;

  if v_member.id is null then
    if v_name = '' then raise exception 'A name is required to join.'; end if;
    -- "me" and the organiser's name mean the organiser on the trip page: a guest may not take them.
    if v_low = 'me' or v_low like 'me (%' or v_low = lower(btrim(coalesce(v_trip.owner_name, ''))) then
      raise exception 'That name is the trip organiser''s. Please use your own name.';
    end if;
    if exists (select 1 from public.trip_members m where m.trip_id = v_trip.id and lower(btrim(m.display_name)) = v_low) then
      raise exception 'Someone has already joined as "%". If that is you, open the link on the phone you joined with; otherwise add your surname.', v_name;
    end if;
    if (select count(*) from public.trip_members m where m.trip_id = v_trip.id) >= 60 then
      raise exception 'This trip is full.';
    end if;
    insert into public.trip_members (trip_id, display_name, guest_token)
      values (v_trip.id, v_name, encode(gen_random_bytes(18), 'hex'))
      returning * into v_member;
  end if;

  return query select v_trip.id, v_trip.name, v_member.id, v_member.guest_token, v_member.display_name;
end $$;

create or replace function public.trip_set_my_upi(p_invite_token text, p_guest_token text, p_upi text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_trip public.trips;
  v_upi text := nullif(lower(btrim(coalesce(p_upi, ''))), '');
begin
  select * into v_trip from public.trips t where t.invite_token = p_invite_token and t.invite_enabled limit 1;
  if v_trip.id is null then raise exception 'This trip link is not active.'; end if;
  if v_upi is not null and v_upi !~ '^[a-z0-9._-]{2,64}@[a-z][a-z0-9.-]{1,30}$' then
    raise exception 'That does not look like a UPI ID (e.g. name@okhdfcbank).';
  end if;
  update public.trip_members m set upi = v_upi where m.trip_id = v_trip.id and m.guest_token = p_guest_token;
  if not found then raise exception 'Join the trip first.'; end if;
  return v_upi;
end $$;

drop function if exists public.trip_member_upis(text);
create function public.trip_member_upis(p_invite_token text)
returns table(member_name text, upi text, member_id uuid, is_owner boolean)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select m.display_name, m.upi, m.id, false
      from public.trip_members m join public.trips t on t.id = m.trip_id
     where t.invite_token = p_invite_token and t.invite_enabled and m.upi is not null
    union all
    select coalesce(t.owner_name, 'Organiser'), t.owner_upi, null::uuid, true
      from public.trips t
     where t.invite_token = p_invite_token and t.invite_enabled and t.owner_upi is not null;
end $$;

create or replace function public.trip_add_expense(p_invite_token text, p_guest_token text, p_amount numeric, p_description text,
  p_spent_at timestamptz default now(), p_split_among jsonb default null)
returns public.trip_expenses language plpgsql security definer set search_path = public as $$
declare
  v_trip public.trips;
  v_member public.trip_members;
  v_expense public.trip_expenses;
begin
  select * into v_trip from public.trips where invite_token = p_invite_token;
  if not found then raise exception 'Trip not found.'; end if;
  if not v_trip.invite_enabled then raise exception 'This trip link is not active.'; end if;
  if not v_trip.allow_guest_adds then raise exception 'Adding expenses is currently turned off for this trip.'; end if;

  select * into v_member from public.trip_members where trip_id = v_trip.id and guest_token = p_guest_token;
  if not found then raise exception 'Join the trip first before adding expenses.'; end if;

  -- NaN compares above every number in Postgres, so the upper bound also refuses it.
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then raise exception 'Amount must be greater than zero.'; end if;
  if p_description is null or length(trim(p_description)) = 0 then raise exception 'Add a description.'; end if;
  if p_spent_at is not null and (p_spent_at < timestamptz '2000-01-01' or p_spent_at > now() + interval '7 days') then
    raise exception 'That date does not look right.';
  end if;
  if p_split_among is not null and (jsonb_typeof(p_split_among) <> 'array' or jsonb_array_length(p_split_among) > 60
     or exists (select 1 from jsonb_array_elements(p_split_among) x where jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') > 40)) then
    raise exception 'The split list is not valid.';
  end if;

  insert into public.trip_expenses (trip_id, member_id, added_by_name, amount, description, spent_at, split_among)
    values (v_trip.id, v_member.id, v_member.display_name, p_amount, left(trim(p_description), 80), coalesce(p_spent_at, now()), p_split_among)
    returning * into v_expense;
  return v_expense;
end $$;

-- Grants: functions are executable by PUBLIC by default, and Supabase grants anon/authenticated too.
revoke execute on function public.trip_join(text, text, text) from public;
revoke execute on function public.trip_set_my_upi(text, text, text) from public;
revoke execute on function public.trip_member_upis(text) from public;
revoke execute on function public.trip_add_expense(text, text, numeric, text, timestamptz, jsonb) from public;
revoke execute on function public.trip_summary(text) from public;
grant execute on function public.trip_join(text, text, text) to anon, authenticated;
grant execute on function public.trip_set_my_upi(text, text, text) to anon, authenticated;
grant execute on function public.trip_member_upis(text) to anon, authenticated;
grant execute on function public.trip_add_expense(text, text, numeric, text, timestamptz, jsonb) to anon, authenticated;
grant execute on function public.trip_summary(text) to anon, authenticated;
-- Owner-only functions: signed-in owners only (they are SECURITY INVOKER, so RLS also applies).
do $$
declare f text;
begin
  foreach f in array array['trip_get_or_create', 'trip_set_invite', 'trip_add_owner_expense'] loop
    execute coalesce((select string_agg(format('revoke execute on function %s from public, anon; grant execute on function %s to authenticated;', p.oid::regprocedure, p.oid::regprocedure), ' ')
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f), 'select 1');
  end loop;
end $$;

commit;
