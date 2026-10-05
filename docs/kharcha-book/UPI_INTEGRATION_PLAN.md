# Kharcha Book: real-time UPI expense capture (plan for Antigravity)

Goal: automatically record only the money the user *spends* through UPI/bank (outgoing, completed payments) into Kharcha Book, in near real time, without typing.

## 1. Verdict: what is and is not possible

| Route | Possible? | Notes |
|---|---|---|
| Official UPI / NPCI / GPay / PhonePe / Paytm API to read a person's own transactions | **No** | NPCI exposes no personal-history API. PSP APIs (Razorpay, PhonePe PG, Paytm PG) are for *merchants* receiving money, not for reading a user's spending. |
| RBI Account Aggregator (Finvu, OneMoney, etc.) | **Not realistic now** | Consent-based bank data, but only regulated FIUs can onboard. Data is periodic, not real time. Long-term option only. |
| **Android: read payment notifications and bank SMS on the phone** | **Yes (recommended)** | Fires within seconds of the payment. Already half-built in this repo (the native SpendTrack app). Android only. |
| Web page / PWA (Kharcha Book as it is today) | **No** | Browsers cannot read notifications or SMS. |
| iPhone | **Partly** | No notification or SMS access for apps. Only an iOS Shortcuts automation ("when I get a message from HDFCBK") that POSTs to a webhook. Fragile. |
| Parse bank debit-alert **emails** (Gmail API, push) | **Yes, as a fallback** | Works for iOS and web. Needs Gmail OAuth. Slower and bank-dependent. |
| Pay *through our own app* using UPI intents (`upi://pay`) | Possible but different product | Returns an exact status for payments made inside the app only. Not "all spending". Not recommended. |

**Recommended architecture:** the Android SpendTrack app is the *sensor*, Supabase is the backend, Kharcha Book (web/PWA) is the *viewer*. Coverage is "every payment that produces a notification or SMS". It will never be 100%, so add a periodic reconciliation (CSV statement import) later.

Do **not** use an AccessibilityService or screen scraping of UPI apps. It violates the UPI apps' terms and Google Play policy.

## 2. Current state (read this first)

**Repo:** https://github.com/yadavs8/SpendTrack (public, default `main`).
- Android app: `app/src/main/java/com/spendtrack/app/` (Kotlin, Compose, Room, two flavors `play` and `sideload`).
  - Capture: `service/SpendTrackNotificationListener.kt`, `service/SmsReceiver.kt` (sideload only).
  - Parsing: `core/parser/TransactionParser.kt`, `core/parser/rulepack/*`, `assets/rules_default.json`, `core/normalizer/MerchantNormalizer.kt`, `core/categorizer/CategoryEngine.kt`.
  - Dedup: `core/deduplication/DeduplicationEngine.kt`. Storage: Room entity `TransactionEntity` (money as `Double`, `source` = NOTIFICATION/SMS/MANUAL/IMPORT, `upiReference`, `bankReference`, `accountLast4`, `needsReview`, `isExcluded`, `transactionType`).
  - Battery-killer help: `core/utils/OemBatteryHelper.kt`.
  - **The Android app declares no network permission and the README promises "zero network egress".** Sync must be opt-in and the README/disclosures updated.
- **Open draft PRs #1, #2, #3 (not merged)** hold important Android fixes: the shared false-positive filter (OTP, payment requests, reminders, offers, failed/pending, incoming money), `goAsync()` in the SMS receiver, notification de-dup/group-summary skipping, biometric lock fix, CSV import fixes, and a CI workflow (`.github/workflows/android.yml`). `main` does **not** have these. Review and merge them first (they were never built on a device; PR #1's CI was green).
- Web app (Kharcha Book): `web/kharcha-book/` (static, no build; `app.js`, `index.html`, `styles.css`, `config.js`, PWA `manifest.webmanifest` + `sw.js`). Live at https://yadavs8.github.io/SpendTrack/web/kharcha-book/ (GitHub Pages from `main` root). Sign-in is email one-time code (existing users only) with a password fallback, plus a client-side WebAuthn fingerprint/PIN lock.
- Merged web PRs: #4, #5, #6.

**Supabase:** project `studio5-portal`, ref `qyjsvumaottbatpdvsaw`, URL `https://qyjsvumaottbatpdvsaw.supabase.co`, region ap-northeast-1, Free plan, org "yadavs8's Org". The anon (public) key is in `web/kharcha-book/config.js`. Never commit the service_role key.
- This project also runs a business billing app. Existing tables include `client`, `payment`, `tax_invoice`, `audit_log` and others. Do not touch them.
- Table `public.daily_expenses`: `id uuid pk`, `user_id uuid default auth.uid()` (fk `auth.users`, cascade), `amount numeric(12,2) > 0`, `description text (1..60 chars)`, `spent_at timestamptz default now()`, `created_at`. RLS on; 4 policies (select/insert/update/delete, role `authenticated`, `auth.uid() = user_id`). Index `(user_id, spent_at desc)`. Source SQL: `supabase/daily_expenses.sql`. It was applied with the SQL tool, so there is no migration-history entry.
- Security note: in `studio5-portal`, signed-in users can already execute security-definer functions of the billing app (`fn_allocate_document_number`, `fn_bump_document_sequence`, `fn_audit_row`). **Recommended: move Kharcha Book to its own Supabase project before adding automatic capture**, and keep public sign-ups off.

## 3. Target architecture

```
UPI app / bank notification  ─┐
Bank SMS (sideload flavor)   ─┴─> Android SpendTrack
                                  parse -> filter (expenses only) -> normalize -> dedupe
                                  -> Room (local queue) -> WorkManager sync (retry, backoff)
                                       |  HTTPS, user JWT (Supabase email-OTP session)
                                       v
                          Supabase  public.daily_expenses  (RLS per user)
                                       |  Realtime (postgres_changes)
                                       v
                          Kharcha Book web/PWA: new entry appears live
```

Why direct upsert with the user's JWT (not a service key): RLS already isolates users, and no server secret ships in the app. Add an Edge Function only if server-side validation or iOS/email ingestion is needed (Phase 5).

## 4. Data model change (draft migration, review before applying)

```sql
alter table public.daily_expenses
  add column if not exists source        text not null default 'manual'
        check (source in ('manual','notification','sms','import','email')),
  add column if not exists merchant      text,
  add column if not exists upi_ref       text,
  add column if not exists bank_ref      text,
  add column if not exists account_last4 text check (account_last4 ~ '^[0-9]{4}$'),
  add column if not exists client_id     uuid,           -- TransactionEntity.id, makes sync idempotent
  add column if not exists device_id     text,
  add column if not exists confidence    real,
  add column if not exists needs_review  boolean not null default false,
  add column if not exists is_excluded   boolean not null default false,
  add column if not exists updated_at    timestamptz not null default now();

-- plain unique constraints (NULLs are distinct) so PostgREST on_conflict works
alter table public.daily_expenses
  add constraint daily_expenses_user_client_uq  unique (user_id, client_id),
  add constraint daily_expenses_user_upi_ref_uq unique (user_id, upi_ref);

alter publication supabase_realtime add table public.daily_expenses;
```

- Do **not** upload raw notification/SMS text. Keep it on the device only (privacy). Upload only parsed fields.
- Money: Android keeps paise as integers internally; send `amount` as a decimal string/number with 2 places.
- `description` must stay 1 to 60 chars: use the normalized merchant name, truncated.
- RLS stays as is. Add a trigger to bump `updated_at` on update.
- The web app must filter `is_excluded = false` and surface `needs_review` items (it currently ignores both).

## 5. Phased work plan

### Phase 0: Baseline (small)
1. Review, test and merge PRs #1, #2, #3 (they all touch the parser, listener and view-models, so expect overlaps; merge in order #1 -> #2 -> #3 and resolve conflicts). Confirm `./gradlew testPlayDebugUnitTest assemblePlayDebug assembleSideloadDebug` passes in CI.
2. Decide Supabase project: create a dedicated project (free plan allows 2 active; pause or upgrade) and move `daily_expenses` + auth there. Update `web/kharcha-book/config.js`.
3. Turn off public sign-ups; confirm the Magic Link email template contains `{{ .Token }}`.
Acceptance: Android CI green on `main`; web sign-in works on the new project.

### Phase 1: Schema + web viewer
1. Apply the migration above (via a real migration file in `supabase/migrations/`, not ad-hoc SQL).
2. Web: show source badge (UPI/SMS/manual), merchant, a "Needs review" list with confirm / exclude / edit, hide excluded, and live updates via `supabase.channel('daily_expenses').on('postgres_changes', ...)`.
3. Web: extend edit to change date and time (needed for corrections).
Acceptance: inserting a row from the SQL editor shows up on an open web page within ~2 seconds; excluded rows never count in totals.

### Phase 2: Android sync
1. Add `INTERNET` permission, Supabase auth (supabase-kt or raw REST). Email OTP sign-in screen; keep tokens in `EncryptedSharedPreferences`; refresh before expiry.
2. New `SyncRepository` + `WorkManager` `SyncWorker`: select Room rows not yet synced, `upsert` to `daily_expenses` with `on_conflict=user_id,client_id`, mark synced, exponential backoff, constraint `NetworkType.CONNECTED`. Trigger one-time work right after each new transaction for "real-time".
3. Add `syncedAt`, `remoteId` to `TransactionEntity` (Room migration, bump DB version, write a migration test).
4. Settings: "Sync to Kharcha Book" off by default, clear explanation, sign out wipes tokens. Update README privacy text; Play flavor needs a data-safety disclosure.
Acceptance: pay Rs 1 via GPay with the phone online -> the entry shows on the web within ~10 seconds; airplane mode -> shows after reconnect; no duplicates after reinstall.

### Phase 3: Expenses only, and correct
1. Use the shared `TransactionFilter` from PR #2: reject OTP, requests, reminders, future debits, offers, failed/pending, incoming money, credits.
2. Self-transfers and credit-card bill payments -> `INTERNAL_TRANSFER` and not synced as expenses (registered accounts feature already exists).
3. Cross-source de-dup: one payment can raise a GPay notification, a bank SMS and a bank-app notification. Key on `upi_ref` (12-digit RRN) when present, else amount + merchant + a +-2 minute window; keep the richest record, merge the rest. The DB unique constraint is the last line of defense.
4. Refunds: add a negative/linked entry or reduce the original (decide and document).
5. Add a golden-file test set of real (redacted) notification/SMS samples for each bank and app, run in CI.
Acceptance: test corpus passes with zero false positives for OTP, requests and credits.

### Phase 4: Reliability on real phones
1. Handle `NotificationListenerService` rebind (`requestRebind`), battery optimization exemptions, OEM autostart guidance (existing `OemBatteryHelper`), and a health screen ("last capture", "listener connected").
2. Use `goAsync()` in `SmsReceiver`; avoid long work in `onNotificationPosted`; hand off to a coroutine/WorkManager.
3. Test on Xiaomi/Vivo/Oppo/Samsung (the app's own README lists these as aggressive killers).
4. Daily reconcile job: compare against a monthly CSV/PDF bank statement import and flag missing or duplicate entries.

### Phase 5: Optional extensions
- iOS Shortcuts automation -> Supabase Edge Function `ingest-expense` (validates a per-user ingest token, never a service_role key in the client).
- Gmail debit-alert ingestion via Gmail API push + an Edge Function parser (works without Android).
- Account Aggregator integration only if the project becomes a regulated product.

## 6. Security, privacy, compliance checklist
- RLS on every table; no service_role key in clients or repo.
- No raw SMS/notification text leaves the device; redact account numbers and UPI IDs in logs (`SafeLogger` already does this).
- Notification Access needs Google Play's prominent disclosure (already in onboarding). SMS permissions are for the `sideload` flavor only.
- Sync is opt-in, with a visible "delete my cloud data" action.
- Keep the web lock as a convenience only; real protection is Supabase auth + RLS.
- Pin supabase-js (web) and review dependency updates.

## 7. Known limitations to tell the user
- Only payments that raise a notification or SMS are captured; if a notification is disabled, dismissed by an OEM, or the phone was off, there is no record.
- Formats change; rule packs need maintenance. The "Teach This Format" feature exists for this.
- Android only for real-time capture. iOS needs a fragile Shortcuts workaround.
- Delays: the notification arrives when the app posts it, which can lag the actual debit by seconds to minutes.

## 8. Open decisions for the owner
1. New dedicated Supabase project, or keep `studio5-portal`? (Recommended: dedicated.)
2. Ship on the Play Store (notification listener only) or sideload only (adds SMS)?
3. Refund handling model.
4. Should the Android app be the main product with web as a viewer, or keep both as equals?
5. Is iPhone support required?

## 9. Definition of done (MVP)
Pay with GPay/PhonePe/Paytm on the Android phone -> within ~10 seconds the exact expense (amount, merchant, time) shows in Kharcha Book on the phone's home-screen app; incoming money, OTPs and requests never show; duplicates never show; works after reboot and after the app has been idle for a day.
