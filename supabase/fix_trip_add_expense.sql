-- Kharcha Book: Fix for "record v_trip has no field allow_guest_adds" error
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

-- 1. Add allow_guest_adds column to public.trips if missing
alter table public.trips add column if not exists allow_guest_adds boolean not null default true;

-- 2. Ensure split_among column exists on public.trip_expenses
alter table public.trip_expenses add column if not exists split_among jsonb;

-- 3. Drop any older 5-arg overload of trip_add_expense
drop function if exists public.trip_add_expense(text, text, numeric, text, timestamptz);

-- 4. Re-create trip_add_expense (clean, robust implementation)
create or replace function public.trip_add_expense(
  p_invite_token text,
  p_guest_token text,
  p_amount numeric,
  p_description text,
  p_spent_at timestamptz default now(),
  p_split_among jsonb default null
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

  insert into public.trip_expenses (trip_id, member_id, added_by_name, amount, description, spent_at, split_among)
    values (v_trip.id, v_member.id, v_member.display_name, p_amount, trim(p_description), coalesce(p_spent_at, now()), p_split_among)
    returning * into v_expense;

  return v_expense;
end;
$$;

-- 5. Grant execute rights to anon (guest friends) and authenticated (owner)
grant execute on function public.trip_add_expense(text, text, numeric, text, timestamptz, jsonb) to anon, authenticated;
