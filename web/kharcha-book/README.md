# Kharcha Book

Daily expense tracker (static web app, no build step) backed by Supabase.

## Setup
1. In the Supabase SQL editor, run `../../supabase/daily_expenses.sql` (creates only `daily_expenses`, with RLS).
2. `config.js` is committed with the project URL and the public anon key (safe to expose; RLS protects the data). To use another project, edit it or start from `config.example.js`.
3. Serve this folder with any static server, e.g. `python3 -m http.server 8080`, and open it on your phone or desktop.
   Sign-in only: create your user in Supabase (Authentication > Users > Add user) and turn off new sign-ups (Authentication > Sign In / Providers).

4. Run `../../supabase/daily_expenses_v2_sms.sql` once as well. It adds `ref_no` and `raw_sms`, so the same bank SMS can never be added twice. The app still works before this runs, but then it can only warn about "same amount, same day".

5. Run `../../supabase/kharcha_v5_money_types.sql` once. It adds `kind`, `method`, `account_last4` and `bank`, so spending can be split by credit card / debit card / UPI / cash / net banking. Both apps work without it, but payment methods and the cash wallet need it.

## Payment methods, income and cash (with the SpendTrack phone app)
- **How it was paid**: every detected payment is classified as credit card, debit card, UPI, net banking (NEFT/IMPS/NACH), wallet or ATM, with the card's last digits and bank. "By payment method" lists each card separately. You can also pick "Paid via" when adding or editing an entry.
- **Income**: bank credits (salary, UPI received, interest, cashback) are logged under Incomings automatically. Money from your own accounts is ignored, and money from the people under "Family who reimburse you" counts as "👵 Withdrawn from Mother". If you add income by hand that the phone already logged, Kharcha Book asks before adding it twice.
- **Refunds** reduce the original expense, or remove it if the refund was full. A refund that can't be matched is logged as income.
- **Cash**: an ATM withdrawal goes into the cash wallet instead of spending. Until you log what it was spent on, it shows as "💵 Unaccounted cash", so month totals stay correct and cash is never counted twice.

## Phone automations (SpendTrack → Settings → Automations, each can be turned off)
Budget alerts at 80% and 100% · credit card due-date reminders from statement SMS · reminders before recurring bills · evening cash-spend nudge after an ATM withdrawal · family settle-up on the 1st with a WhatsApp message · Sunday weekly summary.

## Bank SMS parsing
**Parse Bank SMS** (or sharing an SMS to the app, or copying one before opening it) only adds money that actually left your account. These are rejected with a reason: failed or declined payments, refunds and reversals, cashback, money received, payment requests, bill / autopay reminders, credit card bill payments and transfers between your own accounts, OTPs, offers, and scam messages (KYC, "account blocked").

The preview shows the bank, account, reference number and a confidence label. You can fix the amount, description and date before adding. The date comes from the SMS, not the time you paste it. If you change a merchant's description, the next SMS from that merchant uses your version (saved on this device).

Run the tests with `node test-kharcha.js`. Add any SMS that gets misread to that file.

## Install on a phone
Open the page in Chrome (Android) and tap the menu > **Add to Home screen** / **Install app**. On iPhone use Safari > Share > **Add to Home Screen**.

## Fingerprint / PIN lock
After signing in, tap **Turn on fingerprint / PIN lock**. The app then asks for the phone's fingerprint, face, PIN or pattern when it opens and after it has been in the background for a minute.
This is a lock on the device. The sign-in session stays in the browser, so it keeps casual users out but is not server-side verification. Needs HTTPS (GitHub Pages is) and a phone screen lock.

## Email code sign-in
The page signs in with a one-time email code (existing users only; it never creates accounts). A password option remains as a fallback.
For the code to arrive, the Supabase email template must include the code: Authentication > Email Templates > **Magic Link**, add `{{ .Token }}` to the message (for example: `Your Kharcha Book code is {{ .Token }}`).
After the first sign-in the app offers to turn on the fingerprint / PIN lock, so later opens skip signing in.

## Trip settle-up and Udhaar
- Trips tab: under the split balances, **Who pays whom** shows the fewest payments that settle the trip, and a **For what** view that lists, per pair, which expenses each amount comes from (offsetting what the other person owes back).
- **Udhaar** tab: notes money you lent to friends (or borrowed), with partial repayments, per-person totals and a WhatsApp reminder. It is stored in the shared settings row (`kharcha_loans`), so it syncs like trips do, with no SQL change.
- Logic lives in `ledger-logic.js` (tests: `node web/kharcha-book/test-ledger.js`).

## Wallet (Amazon Pay and other prepaid wallets)
The **Wallet** tab keeps a balance for a prepaid wallet. Type the balance once, then:
- **+ Top-up**: money moved into the wallet (for example from a card). It is a transfer, not spending.
- **Spent from wallet**: a purchase paid from the wallet. It counts as spending and lowers the balance. Log the full price; if part was paid by card, add that part as a top-up.
- **From an entry**: turns a card charge that was really a top-up (like "₹442 towards Amazon Pay") into a top-up so it is not counted twice.
- **Check balance**: compare with the wallet app and log any difference as spending or as a top-up (cashback, refund).
Entries are ordinary rows whose text starts with `👛` (purchase) or `👛➕` (top-up), so no database change is needed. Logic: `ledger-logic.js`.

## Look and feel (v47)
`modern.css` and `modern.js` add the bottom navigation bar (Home, Income, Add, Trips, More), the night-mode button (🌙/☀️, remembered on the device), the 7-day chart and chips on the top card, icon avatars on rows, and smart suggestions: type in the description field and past entries that match appear with their usual amount; tapping one fills the description and, if empty, the amount. They only use what `app.js` exposes (`window.__kharcha`) and the `kharcha:render` event, so they can be removed without touching the app logic.
