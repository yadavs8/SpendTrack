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
