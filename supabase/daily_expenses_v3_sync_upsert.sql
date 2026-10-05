-- Kharcha Book v3: run once in the Supabase SQL editor (Dashboard > SQL Editor > New query),
-- after daily_expenses_v2_sms.sql. Safe to run more than once.
--
-- SpendTrack syncs with PostgREST upsert (?on_conflict=user_id,ref_no). Postgres cannot use the
-- partial index from v2 ("... where ref_no is not null") for that, so every synced row with a
-- UPI reference failed with 42P10. A plain unique index works for upsert and still allows any
-- number of rows without a reference (NULLs are distinct in a unique index).

drop index if exists public.daily_expenses_user_ref_uidx;

create unique index if not exists daily_expenses_user_ref_key
  on public.daily_expenses (user_id, ref_no);

notify pgrst, 'reload schema';
