-- Kharcha Book v5: run once in the Supabase SQL editor (Dashboard > SQL Editor > New query),
-- after the earlier files. Safe to run more than once. Existing rows are kept unchanged.
--
-- kind           expense | income | refund | transfer | cash_withdrawal   (null = read from the description, as before)
-- method         upi | credit_card | debit_card | cash | netbanking | atm | wallet | other   (null = not known)
-- account_last4  last digits of the card / account it was paid from or into
-- bank           issuing bank ("HDFC", "ICICI", "SBI Card"...)
--
-- These let Kharcha Book split spending by credit card / debit card / UPI / cash, show per-card
-- totals, keep ATM cash out of spending until it's itemised, and recognise income reliably.
-- Both apps work without this migration; they just can't show payment methods until it runs.

alter table public.daily_expenses add column if not exists kind text
  check (kind is null or kind in ('expense', 'income', 'refund', 'transfer', 'cash_withdrawal'));
alter table public.daily_expenses add column if not exists method text
  check (method is null or method in ('upi', 'credit_card', 'debit_card', 'cash', 'netbanking', 'atm', 'wallet', 'other'));
alter table public.daily_expenses add column if not exists account_last4 text
  check (account_last4 is null or char_length(account_last4) <= 6);
alter table public.daily_expenses add column if not exists bank text
  check (bank is null or char_length(bank) <= 40);

create index if not exists daily_expenses_user_method_idx
  on public.daily_expenses (user_id, method, spent_at desc);

-- Live updates (safe if already on): new rows from the phone appear without refreshing.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'daily_expenses'
  ) then
    alter publication supabase_realtime add table public.daily_expenses;
  end if;
end $$;

notify pgrst, 'reload schema';
