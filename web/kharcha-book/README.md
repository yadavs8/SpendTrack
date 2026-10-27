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

## Where your money went (v48)
The old "Where it went, biggest first" list was merged into the category section, which is now a donut chart with a colour-keyed list. Tap a category to highlight it (the centre shows its amount and share) and set a budget; each row shows the change since last month.

## Monthly tab (v49)
**More > Monthly** reports one month at a time and lists every month below.
- **Saved this month** = Salary 1 + Salary 2 (and any other 💼 salary) minus personal spending. Investments count as saved and are shown as a chip. Family spending is not part of personal spending.
- **Family fund** = what Mother sent that month (👵 Mother's Pension and Mother Withdrawal entries in Income) minus family spending (🏠 entries, bills). It shows what is left, or how much family spending went **over**, plus your savings after covering the overflow.
- Add salaries and Mother's money each month in the **Income** tab; nothing needs to be set up here.
Logic: `getMonthlySummary` / `getMonthlyHistory` in `app.js` (tests in `test-kharcha.js`).

## Pay cycles and bank balance (v51)
- **Pay cycle** (Monthly tab, default): salary arrives on the last working day, so it pays for the *next* stretch of spending. A cycle runs from one "Salary 1" payday to the next; savings = every salary received in the cycle (Salary 2 too) minus personal spending, with the family fund working the same way. The open cycle shows "saved so far" and the next payday (last working day, holidays not known). Switch to **Calendar month** any time; the word that starts a cycle can be changed. Home screen totals stay calendar months.
- **Bank** (More > Bank): type the balance the bank shows; the estimate then adds the income you log and subtracts spending that really left the account. Not counted: credit-card spends (log the card bill as "Credit card bill"), cash and wallet spends, what friends or Mother paid. **Update balance** compares with the bank and can log the gap as spending. The estimate also shows on the home screen.
Logic: `payCycles`, `nextPayday`, `bankEstimate` in `ledger-logic.js`; `getPeriodSummary`, `isBankOut` in `app.js`.

### Cash income and the bank
If an income was paid in cash and kept at home, open More > Bank and tap **Kept as cash** next to it: it stays out of the bank estimate. When you deposit it, tap **Deposited ✓**. The deposit raises the bank balance but is a transfer, so income and savings are never counted twice. Do not log the deposit as a new income.

### Auto rules, bank accounts and income
More > Auto rules: names the app recognises (milk vendor, niece allowance, flat EMI), the day each is due, and which bank it comes from. On the due day a card on Home offers **Log it**. Every money-in and money-out belongs to one bank account: the rule's bank (HDFC for the EMI), else your Main account (ICICI). Income has a **Credited to** choice (a bank, cash at home, or not a bank). In the edit screen, **Income** moves a wrongly filed spend into Incomings.

### Moving money between your own accounts
More > Bank > **Move money between accounts** (needs two tracked accounts): pick From, To, amount and date. One balance goes down and the other up; it is never spending or income. A bank SMS that was logged as a spend can be converted from the edit screen with **Own transfer**. Undo is offered after each change.

### Own accounts, cards and transfer suggestions
More > Auto rules > My accounts and cards: last 4 digits of each bank account, your credit and debit cards, and your own UPI ids. A payment that mentions an account's last 4 is filed under that bank; credit-card spends stay out of the bank balance, debit-card spends come off the card's bank. When an entry names your own account, or an expense and an income of the same amount appear within 36 hours, Home suggests **Yes, own transfer / Swap / No**. Nothing is converted without a tap.

### Automatic own transfers
Payments to yourself are filed as own transfers without a tap. The signals: the payee is one of your own names (More > Auto rules > My accounts and cards), or it names your own account number or UPI id. The source bank comes from the SMS ("Acct XX602 debited" is ICICI); banks that print only the last 3 digits still match. An Undo toast follows each one. A credit from your own name that mirrors a transfer you already have is filed as the other half, not income.

### Own transfer from the phone notification, and no double counting
The phone's payment notification now has **↔ Own transfer** next to Personal and Family (tap the notification itself for every other destination). It files the payment with a 🔁 mark; Kharcha Book then creates the balance move by itself (source bank from the SMS, destination the other tracked account). Corrections: a transfer is counted once (same entry, or the same amount between the same two accounts within 10 minutes, and twin SMS/notification copies of one payment hide together); a payment that already has a transfer record but lost its 🔁 mark when the phone re-synced it plain is marked again; a 🔁 entry with no record gets one.

### Balance from bank SMS
When a bank SMS prints the balance ("Avl Bal Rs 12,345.67"), the app sets that account's balance from it automatically (newest SMS wins, never older than a balance you typed later). Card SMS ("Avl Limit") are ignored. The Bank card says "Balance taken from your bank SMS". Banks whose SMS carry no balance (for example ICICI UPI debits) still need an occasional **Update balance**.

### Ash logo
The header logo turns to ash from left to right like a snap, drifts away, then pulls itself back together. It repeats for as long as the app is open (whole logo, ash, gone for a moment, back again) and a tap restarts it. It stays a still image when the phone asks for reduced motion. The home-screen app icon itself cannot animate.

### v68: home answer card, pace colour, hide amounts, search everywhere, tour
- **Safe to spend today** card under the total: bank balance minus bills still to come (from Auto rules), divided by the days to payday. Without a tracked bank it uses your monthly budget. It also says whether this week's pace is on track, close or over.
- The total card colour follows that pace: teal, amber, red.
- The eye on the total card blurs every amount (remembered on this device).
- The search box finds entries in every month: by name, an exact amount (`906`) or a range (`>1000`, `<100`).
- A three-step tour shows once; More > "Show the quick tour" replays it.

### v69: feel
- Opening splash: the rupee gathers itself out of ash (once per session; tap to skip; never longer than about 4 seconds).
- Money flies to the total when you add a spend (red) or an income (green with a coin burst).
- Soft sound and vibration on save, income and delete. More > Look and feel turns each off.
- Themes: Light, Midnight, Thanos (purple and gold). More > Look and feel.
- Screens fade in; cards and buttons press down; empty screens get a picture and a next step.
- Tool screens (Bank, Udhaar, Wallet, Auto rules, Monthly) no longer show the month card above them.

### v70: Insights (More > Insights)
- **Net worth**: banks + cash at home + wallets + what friends owe you − what you owe, with a 30-day line worked backwards from the bank movements (an estimate).
- **Your week**: four swipeable cards: the week against the one before, where it went, the biggest moment, and one tip.
- **Streak**: consecutive days under your daily limit (monthly budget / 30, or the safe-to-spend figure from your bank).
- **Savings goal**: a ring, "Add money", edit and remove with Undo (stored with your other settings).
- **Heatmap**: a calendar shaded by what you spent each day; tap a day to see it.

### v71: bills calendar, spend sources, month report, backup
- **Bills calendar** at the top of More > Auto rules: each rule with a day of the month shows on a month calendar (paid, coming up, not logged yet).
- **Where it left from** (Insights): this month or last month split by bank account, credit card, cash, wallet and what others paid.
- **Month report** (Insights): a picture of the month (spent, salary and saved, where it went, day by day) to share or save.
- **Your data** (Insights): download every entry and setting as one file; restore it later. Restoring skips entries you already have.

### v72: receipt photos
Open an entry, tap **Add photo**: the picture is shrunk to a small JPEG and kept in a private Supabase Storage bucket (`kharcha-receipts`, one folder per user, row-level security so only you can read it). Entries with a receipt show 📎; View, Replace and Remove (with a confirmation) are in the edit screen. Deleting an entry removes its photo after the Undo window; Undo keeps it. Backups save the receipt marks, not the photos.
SQL used (already applied to the project): `insert into storage.buckets ... 'kharcha-receipts'` plus four policies on `storage.objects` restricted to the user's own folder.

## v73 – Winged logo
The in-app header logo and splash now show a winged ₹ that flaps, lifts off through the top of the screen, vanishes, then drops back (tap to skip ahead). The home-screen / PWA icon is unchanged.

## v75 – Fire removed
Flames taken off the winged ₹ (back to the v73 look).

## v76 – No more repeated questions, no duplicates, credit card tab
**Phone (SpendTrack app, needs a fresh install from `main`):**
- A payment you already entered in Kharcha Book (Family, Personal, a trip…) no longer asks "where should this go?". Matching is by amount and time (±36 h); it is checked when the SMS arrives, before every reminder, every ~30 min in the background and when the app opens, and the notification and its reminders disappear.
- Known payees are filed by themselves and the notification says where: "🤖 Auto-logged under 🏠 Family". They come from the Auto rules screen (shared with the web app): niece allowance, milk vendor (Family), LIC premium on the 22nd (Investment), small insurance premium on the 16th (Personal), flat EMI.
- A debit from one of your bank accounts and a credit into another a few minutes apart (even Rs 2, even with no shared reference) is one own transfer: one 🔁 entry, no questions.
- Once a day the phone reads every bank SMS since the 1st of the month and files anything it missed, through the same rules and duplicate check. Old messages never pop a prompt.

**Kharcha Book (web):**
- Duplicate check runs every time entries load or refresh: the same payment twice (same SMS text, or a copy without the bank reference) is removed by itself with Undo; likely duplicates are only suggested ("Remove one" / "Keep both"). A row that carries a bank reference is never deleted.
- Own transfers between your two banks are found from the two bank SMS even when no name is mentioned; the credit side no longer becomes a second, reversed transfer.
- Auto rules: new built-in rules LIC premium (22nd, ₹5,000) and Insurance premium (16th, up to ₹2,000), added once to your list (delete one and it stays deleted). Rules can have an amount cap and "only near its day".
- 💳 **Credit card** screen (More > Credit card): what the card owes and what is available (exact from the card SMS "Avl Limit" once you type the limit; otherwise your starting figure + spends − bill payments), usage bar, and every card spend by day for this month / last month / all time.

## v77 – Nothing is silent any more
- **Why a credit can go unnoticed:** a message is only logged when the parser recognises its wording. Bank wording varies ("Acc XX602" instead of "Acct", "credited:Rs.", "NACH*COMPANY*DIVIDEND"), and the SMS-app notification path was stricter than the SMS path. A message that did not match was dropped without a word. Now: "Acc" wording, NACH/ACH/ECS dividends and interest are understood, and the income notification is audible and says which account got it ("💰 ₹161 credited to ICICI ··602").
- **Safety net:** any bank message with an amount and words like credited/debited/received that the parser still cannot read is kept, and you get "📩 ₹161 — I couldn't read this bank message" with **💰 It's income** / **💸 It's a spend**. Tapping one files it properly (a spend still asks where it goes). Messages from the last two days are announced; the daily catch-up since the 1st keeps older ones quietly.
- **Income tab** now also shows where this month's credits landed (all in your main bank; the other only by own transfers) and what they were (salary, family, dividend, interest, cashback, other).

## v78 – Gear always reachable
The phone-app ⚙️ button was being squeezed off the right edge of the header; the header is now tighter so title, logo, theme, version and ⚙️ all fit. Inside the phone app, More > Phone settings opens the same screen (SMS and notification access, Cloud Sync, lock).

## v79 – Phone connection
More > 📡 Phone connection: shows whether bank messages are really reaching Kharcha Book (latest message, count for 24 h and the week), which email you are signed in with (the phone app must use the same one to sync), a button to open the phone app settings when you are inside the Android app, and a checklist (SMS permission, notification access, battery Unrestricted, Cloud Sync sign-in). Also in More: ⚙️ Phone settings (app only).

## v80 – Signed-out phone is no longer silent
Checked on the live database: the phone sent payments until the evening of 11 Oct and then stopped. The usual cause is the phone app being signed out of Kharcha Book (its session is separate from the website's). The phone now posts a notification when that happens ("You are signed out… sign in again"), at most twice a day; payments wait on the phone and are sent after signing in. The money-types columns (kind, method, last 4, bank) were also missing from the live database and have been added.

## Trip friends' UPI IDs (v101)
Friends joining a trip link can enter their UPI ID (optional) or add it later with "Add my UPI". It is saved with them on the trip and prefills "Pay via UPI" for everyone. Additive only: existing data and settings are untouched.

## Smart search (v105)
The search box understands related words: "hair" finds salon/barber/parlour spends, "petrol" finds filling stations and pumps (HP, Indian Oil, Shell...), and likewise food, grocery, medicine, travel, recharge, bills, shopping and more. Small typos are tolerated, several words narrow the result, and amounts still work (906, >1000). It searches all months, newest first.

## Per-bank balances, forecast, unusual spends, ask (v106)
- Each bank (ICICI, PNB, ...) is added by itself from your bank SMS and its total moves to the newest balance the bank prints. No pop-ups. Only the ICICI balance is shown at the top of the app; all banks are under More > Banks.
- Credit card spends stay separate under the Credit card screen and never touch bank balances.
- Insights now has a month-end forecast and an "unusual spends" card (a payee far above its usual amount, or charged twice in a day).
- The search box answers questions: "food last month", "petrol this week", "how much did I spend today".

## Only your own banks (v107)
A bank SMS only updates the balance of that same bank. SMS from other banks (for example a family member's account) no longer touch your ICICI balance or count as bank money, and the top of the app shows ICICI only. Earlier wrong balances are repaired automatically.

## Calm home (v110)
The dashboard shows only the month total, the 7-day bars, today / 7 days / average, the safe-to-spend line, one "Add a spend" bar (the + button opens the full form, which folds away after saving), search, and the day-by-day list. Several due payments fold into one line, past months fold away, and the budget strip is hidden until a budget is set.

## Tappable top card (v111)
Tap any bar of the 7-day chart, or the Today / 7 days / Avg per day boxes, to see how much was spent and what it went on (categories and the biggest payments). The day you spent the most blazes with a flame; the other days are cool ice-blue, and today has an outline.

## Money back from the same person (v112)
When someone sends back money you paid them (you pay Rishabh ₹10,700, he returns ₹10,700), Kharcha Book matches the two by the person's name from the bank SMS and counts neither as spending nor income (with Undo). It also matches when the return adds up to two or three recent payments to that person. A partial return asks first ("Rishabh sent ₹4,000 back?") and then lowers the original spend, noting "(↩ ₹4,000 back)". More > Udhaar shows "Sent and got back" for every person: sent, got back, and who is down; tap a person for the payments, and "It was income" undoes a match.

## Tap Today to jump to it (v113)
Tapping Today, or any bar of the week chart, scrolls down to that day in "Day by day", opens it and highlights it. When the day is not in the list (another month open, or a filter hides it) the summary popup opens instead. The popup now draws above everything inside the phone app too.

## Credit card on the home screen (v114)
"Where your money went" is gone from the home screen. In its place: this month's credit card spends (total and number of swipes). Tap it to see every card spend date-wise, with each day's total, and a link to the full card screen (what the card owes). Categories still show in the week and day popups on the top card.

## Calendar, pictures, sidebar, cash per bank (v115)
- Home has a month calendar: every date is a box coloured by how much was spent (the biggest day glows red/orange), with small pictures of what it went on (🍔 food, 📺 subscription, ⛽ fuel, 🛒 grocery, 🏧 cash...). Tap a date for that day's spends with pictures and times; "Edit these in the list" jumps to it. Below the calendar, the month's categories as picture chips (tap one to see every spend in it).
- Every spend in the list shows a picture and a coloured category label (Food, Subscription, Fuel, Grocery, Health, Travel, Salon, Shopping, Bills, Mobile & internet, Insurance, To a person...).
- Day by day shows the two newest days; "Show all days" brings the rest.
- ☰ menu at the top left opens a sidebar with every page.
- Bank page: each bank shows the cash withdrawn from it this month (and last month), with dates.
- Neater pages: consistent cards, spacing and headings on Bank, Trips, Udhaar, Card, Wallet and the rest; the trip picker no longer runs off the screen.

## Day card always on screen (v116)
Tapping a calendar date, a week bar or a top-card box opens a solid card near the top of what you are looking at (no longer pinned to the bottom edge, where the phone's navigation bar could hide it). Its amounts show even when "hide amounts" is on, since you opened it on purpose. Tap ✕ or outside to close.

## Clear calendar amounts, card dropdown (v117)
Calendar amounts sit in a solid pill (dark text on light, light on dark) so they read clearly on every colour, and stay visible in hide-amounts mode. The credit card box is a dropdown: tap it, pick the month (this month or any earlier month with card spends), and each date is its own dropdown showing that day's swipes with pictures, category and time; the newest date opens first. The repeated "By payment method" box is gone from Home.

## Trips home: banners, day-by-day flow, friends from contacts, one link per trip (v118)
- Trips opens on "Your trips": one colourful banner per trip (🏔️ Manali, 🏖️ Goa, 🏜️ Jaipur...) with dates, total and who is on it.
- Tap a banner: the trip's total and per-person share, then **People** (each with what they paid and what they owe or get back, and a "Send link" button), **To settle up**, and a **Day by day** timeline (Day 1, Day 2...) of every spend with a picture, who paid and the category.
- **Add from contacts**: pick a friend from your phone's contacts (inside the Kharcha Book phone app after installing the new APK, or in Chrome on Android); or type a name. Spends split equally between everyone on the trip.
- **Share link / Copy link**: every trip has its own link. "Send link" next to a friend opens WhatsApp straight to that friend when their number came from contacts.
- The full trip tools (budget, categories, add spend, settle-up) are under "More trip tools".
- Home: the "Show all days" button is a solid button and never hides behind the bottom bar.

## Add from contacts fixed (v119)
Inside an older phone app, "Add from contacts" did nothing (the app's browser has a contacts feature that cannot open anything, and the error was silent). Now: in the latest phone app it opens your contacts; in an older app it explains and offers the update (installs over, keeps your data); in Chrome it opens Chrome's contact picker; if anything fails you see a message and can type the name. The phone app also always reports back to the page, even if the picker cannot open.

## Safer phone updates (v120)
- Per-person UPI IDs and trip links now back up to your Kharcha Book account like your other settings, so a reinstall does not lose them.
- The app's signing key is refreshed daily in the build system (it used to be weekly, right at the 7-day point where GitHub drops it), and a build on main now stops instead of quietly making a new key, so an update always installs over the app you have.

## Fix mistakes on a trip (v121)
- **Remove someone**: the × next to each friend on the trip (asks first, says if they had paid for anything, and Undo puts them back). Their spends stay; the split is worked out again.
- **Delete a spend**: tap any spend in the trip's Day by day list (Undo restores it). A spend a friend added from the trip link is deleted for everyone.
- **Rename** the trip from the trip page.

## Install the app from the web page (v122)
On an Android phone in Chrome, Kharcha Book shows a slim "📲 Get the Android app · Install" strip under the header (× hides it) and an "Install the app" entry in the ☰ sidebar. Both open a card with a one-tap Download button and the three install steps, including what to do if Google Play Protect blocks it. Hidden inside the app itself and on iPhone.
