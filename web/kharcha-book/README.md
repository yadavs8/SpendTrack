# Kharcha Book

Daily expense tracker (static web app, no build step) backed by Supabase.

## Setup
1. In the Supabase SQL editor, run `../../supabase/daily_expenses.sql` (creates only `daily_expenses`, with RLS).
2. `config.js` is committed with the project URL and the public anon key (safe to expose; RLS protects the data). To use another project, edit it or start from `config.example.js`.
3. Serve this folder with any static server, e.g. `python3 -m http.server 8080`, and open it on your phone or desktop.
   Sign-in only: create your user in Supabase (Authentication > Users > Add user) and turn off new sign-ups (Authentication > Sign In / Providers).

## Install on a phone
Open the page in Chrome (Android) and tap the menu > **Add to Home screen** / **Install app**. On iPhone use Safari > Share > **Add to Home Screen**.

## Fingerprint / PIN lock
After signing in, tap **Turn on fingerprint / PIN lock**. The app then asks for the phone's fingerprint, face, PIN or pattern when it opens and after it has been in the background for a minute.
This is a lock on the device. The sign-in session stays in the browser, so it keeps casual users out but is not server-side verification. Needs HTTPS (GitHub Pages is) and a phone screen lock.
