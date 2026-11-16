# Kharcha Book (SpendTrack) — audit

Date: 16 Nov 2026 · Branch `ccr-b0a53535-4sjh2k` (= main `c55b460`, v149)
What it is: Android app (Kotlin/Compose/Room) that reads bank SMS and UPI notifications and logs expenses/income,
plus the Kharcha Book web app (`web/kharcha-book`, GitHub Pages), both syncing to the shared `studio5-portal`
Supabase project (tables `daily_expenses`, `kharcha_settings`, `expense_items`, trips, private `kharcha-receipts`).
Sources: REA security-scanner + bug-scanner, code reading, live Supabase (read-only). Web tests: 271 + ledger suite pass.
Status (16 Nov 2026): H1–H3 and M1–M7 FIXED (M6 partly, M2 partly — see notes); M3 fixed in v150.

## High
| ID | Issue | Fix |
|---|---|---|
| H1 | **Money received counted as spending.** "Rahul paid you ₹500" / "Rahul sent you ₹500" notifications: `paid`/`sent` are treated as debit words (TransactionParser.kt:108-111), so `parse()` returns an EXPENSE and `IncomeParser` (which knows "paid you") never runs (:331). Tests call `IncomeParser` directly, not the real path. | Reject `(paid|sent) you` in `parse()` before the debit check; add an end-to-end test through `parseAny`. |
| H2 | **UPI payment diversion on trip pages.** `trip.html?t=<invite>&u=someone@upi` writes `u` unvalidated into the saved-UPI keys the main app also uses (trip.js:20-25), and trip members' UPIs are keyed by display name, so a guest named "Sanjeev" or a crafted link can make "Pay via UPI" prefill another person's UPI ID. `trip_set_my_upi` only checks for an "@". | Drop or confirm `?u=`; key UPIs by member id and per trip; reserve the owner's name and make names unique per trip; strict UPI format check in SQL. |
| H3 | **README's privacy claims are false.** "100% local-first" and "Zero network egress", yet the app uploads up to 500 characters of every raw bank SMS (`raw_sms`), account last-4, bank, reference, amounts and settings to Supabase, in a project shared with the business apps. | Correct the README; upload `raw_sms` only by choice and with balances/account numbers masked. |

## Medium
| ID | Issue | Fix |
|---|---|---|
| M1 | Public APK is a **debug build**: debuggable, no code shrinking, WebView remote debugging on. With USB debugging, the session token (plain SharedPreferences) and the unencrypted database of SMS can be read with `adb run-as`. | Publish a release build (minified, not debuggable) signed with the same key; encrypt the session with the Android Keystore. |
| M2 | **Signing key kept in the Actions cache** with its password; any workflow run (incl. `ccr-*` branches, `workflow_dispatch`) can read it or silently create a new key (next APK then won't install over the old one); release deleted and recreated non-atomically; actions pinned by tag. | Keystore as an encrypted secret; sign/publish only on `main` behind a protected environment; `contents: read` by default; pin actions to SHAs; publish the certificate fingerprint. |
| M3 | **WebView bridge origin check is a prefix match** without a trailing slash (`https://yadavs8.github.io` also matches `https://yadavs8.github.io.evil.com`), applies to every frame, and trusts all of yadavs8.github.io — so the token-reading bridge is one XSS or one other Pages repo away from session theft. | Exact scheme+host+path check; `addWebMessageListener` with allowed origins; ignore calls from sub-frames. |
| M4 | **Trip input checks**: `trip_add_expense` accepts `NaN` / `infinity` (breaks totals for everyone), ignores `allow_guest_adds`, unbounded `split_among`, no member cap. | Reject NaN/infinity and huge amounts; enforce `allow_guest_adds`; bound arrays; cap members and adds. |
| M5 | **Partial refunds ignored in in-app totals**: `SUM(amount)` in TransactionDao.kt:39,55,64 while sync/notifications use `amount - refundedAmount`. | `SUM(amount - refundedAmount)`. |
| M6 | **Phone and web disagree on what an expense is**: KharchaRules.isExpense lacks the web's exclusions (trip entries, wallet top-ups — double counted, "not mine" bank such as PNB). Budget alerts and the weekly summary are inflated. | Mirror the web rule (and fetch `bank`); one shared test table for both. |
| M7 | Duplicate check silently merges two genuine same-amount payments to the same shop within 2 hours when neither has a UPI reference (DeduplicationEngine.kt:183-205). | Flag for review instead of merging when references are missing. |

## Low
- SQL scripts don't `revoke execute … from public, anon` (a fresh install leaves owner functions callable anonymously; live is OK for them).
- Web fingerprint/PIN lock is a screen lock only (credential not verified server-side; token not encrypted) — soften the wording.
- supabase-js from jsdelivr without Subresource Integrity; Google Fonts requests.
- Sync reads use `limit=5000` (server caps at 1000) — page them like the web app does.
- A row without a reference can be uploaded twice if the app dies between upload and "synced".
- `trip.html` loads `?v=105` scripts while the service worker caches `?v=149`.

## Checked and fine
RLS on all Kharcha tables (own rows only) and the private receipts bucket; invite/guest tokens 144-bit random; no XSS sink in the web app (text rendered with textContent); exported components and PendingIntents; backup exclusions; cleartext blocked; paise maths and trip settle-up; Room migrations 1→6.

## Fix status
| ID | Status |
|---|---|
| H1 | FIXED — phone parser and web "Parse bank SMS"; tests through `parseAny` and `parseBankSMS` |
| H2 | FIXED — owner's UPI from `trips.owner_upi` (set by the owner's app), never from the link; per-trip storage on the guest page; server refuses "me"/the owner's name/duplicate names for new joins; strict UPI format (`supabase/kharcha_trip_v2_hardening.sql` + `supabase/tests/kharcha_trip_v2_test.sql`) |
| H3 | FIXED (README) — states exactly what is uploaded. Masking the uploaded SMS text is NOT done: Kharcha Book reads balances, refunds and "not mine" accounts from it — owner's choice |
| M1 | FIXED — published APK is a release build (not debuggable), same app id and key |
| M2 | PARTLY — key used only on `main`, read-only by default, publish job alone writes, release updated in place. Still open: move the key from the Actions cache to an encrypted secret; pin actions to SHAs |
| M3 | FIXED (v150) |
| M4 | FIXED — live already refused NaN/huge amounts and honoured allow_guest_adds; added split-list and date checks, member cap, explicit grants |
| M5 | FIXED — totals net of partial refunds |
| M6 | PARTLY — trips and wallet top-ups now excluded on the phone; "not mine" accounts and paid-back items still counted there (they need the web's settings) |
| M7 | FIXED — same app + same shop + no reference within 2 h: kept and asked, not merged |
| Low | trip.html asset versions fixed; grants explicit. Open: SRI for supabase-js, sync reads past 1000 rows |
