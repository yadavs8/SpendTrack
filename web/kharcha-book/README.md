# Kharcha Book

Daily expense tracker (static web app, no build step) backed by Supabase.

## Setup
1. In the Supabase SQL editor, run `../../supabase/daily_expenses.sql` (creates only `daily_expenses`, with RLS).
2. Copy `config.example.js` to `config.js` and fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY`
   (the same project your other app uses, so the same users can sign in). `config.js` is git-ignored.
3. Serve this folder with any static server, e.g. `python3 -m http.server 8080`, and open it on your phone or desktop.
   If Supabase email confirmation is on, confirm the email after creating an account.
