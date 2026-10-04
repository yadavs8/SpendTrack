-- Kharcha Book v2: run once in the Supabase SQL editor (Dashboard > SQL Editor > New query),
-- after daily_expenses.sql. Safe to run more than once. Existing rows are kept.
--
-- ref_no:  bank / UPI reference number from a parsed SMS. One per user, so the same SMS can't be added twice
--          (from any device). Manual entries leave it empty.
-- raw_sms: the original SMS text, kept so an entry can be checked later.
--
-- The app works without this migration (it skips these columns), but duplicate blocking then only
-- warns on "same amount, same day".

alter table public.daily_expenses add column if not exists ref_no  text check (char_length(ref_no) <= 40);
alter table public.daily_expenses add column if not exists raw_sms text check (char_length(raw_sms) <= 500);

create unique index if not exists daily_expenses_user_ref_uidx
  on public.daily_expenses (user_id, ref_no)
  where ref_no is not null;

-- Make the API see the new columns immediately.
notify pgrst, 'reload schema';
