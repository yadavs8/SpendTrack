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

## Everything closes the way it opened, estimates per category, trip calendar (v123)
- **Tap again to close**: a trip closes by tapping its banner again, the Trips tab, or "All trips"; the + button closes the add form; More and the ☰ menu close on a second tap (☰ also has ×). Every card and sheet closes on ✕ or a tap outside.
- **Phone back button** closes the newest thing that is open (a card, the menu, More, the add form, an open trip), and from any other page goes back Home.
- **Where your money goes** (Home, under the calendar): every category with its own picture (Milk & dairy, Vegetables & fruits, Online shopping, Fuel, Food, Grocery, Subscription, Bills...), what it cost so far, the estimate by month end (dashed part of the bar), and how it compares with last month (red when it is over 20% up). Tap one to see each spend.
- **Trip calendar**: each trip shows its days as boxes (Day 1, Day 2...) coloured by spend, with pictures of what it went on (tap a day for its spends), and bars for Stay, Fuel, Food and the rest. Day numbers match in the calendar and Day by day.
- **Visual touches**: a light sheen across the top card and trip banners, calendar days pop in, the biggest day glows, bars grow in, cards glide up as you scroll. All of it turns off with your phone's "reduce motion" setting.

## Trip mode back, with a travel diary (v124)
- On each trip's page: **▶️ Start trip mode** / **⏸️ Pause** / **▶️ Resume** / **■ End trip**, with a plain line saying what happens. ON: every payment the phone sees is logged to the trip and split equally between everyone on it. PAUSED: payments go to Personal or Family as usual. ENDED: back to normal; the trip stays to view and settle. The trip list shows ● LIVE or ⏸ PAUSED on the banner.
- **Travel diary labels**: trip spends read like "Filled petrol in Gurgaon", "Breakfast in Gurgaon", "Lunch in Chandigarh", "Refilled petrol in Manali", "Stay in Manali". Meals follow the time (breakfast, lunch, evening snacks, dinner, late-night; cafés become "Coffee & snacks"); petrol after the first is "Refilled". The original merchant and time stay underneath.
- **📍 Where are you**: tap it on the trip page (also offered when trip mode starts) to set your town, from the phone's location when allowed or typed in. Spends after that are labelled with that town; a town in the merchant name ("Indian Oil MANALI") wins.
- Settle-up amounts are shown in whole rupees.

## Search tells you everything about a spend (v125)
Search "milk", "petrol", "swiggy" (or an amount) and you get a full panel, not just a list:
- **This month** in big numbers with the number of purchases, and ▲/▼ % against last month (at this month's pace).
- **Last month**, **monthly average** (last 5 months), **per purchase**, and **by month end** (estimate at this pace).
- **6-month bar chart**; tap a month to see only that month (tap again for all).
- **Habits in plain words**: how often you buy it and when ("about every day, mostly in the mornings"), where most often ("Milk vendor, 70 times"), the biggest purchase, and the all-time and yearly cost.
- **Every spend grouped by month**, each month with its own total; months fold open and shut.
- A specific word stays specific: "milk" means milk and dairy (Amul, paneer, curd, ghee...), not all groceries. × clears the search.

## Audit fixes: banks that aren't yours, trip security, layout (v126)

- **Not your bank, not counted.** SMS from a bank that isn't yours (PNB, a parent's account linked to your number) stay visible but never count as your income, spends or cash. The Bank page lists them under "Not your bank" with this month's in/out and a one-tap **Count as mine** (with undo). The setting is `kharcha_not_mine_banks` and syncs across devices.
- **Trip security.** `trip_add_owner_expense` now checks that you own the trip, and signed-out users can't call it. A paused trip link also stops friends adding spends, not just viewing. Amounts and descriptions have sane limits.
- **Faster database rules.** The row-level policies read `auth.uid()` once per query instead of once per row. Two foreign-key indexes were added.
- **Layout.** The Insights page no longer scrolls sideways on phones. A search for "milk" no longer says "incl. milk".

## Autopilot: safe to spend, bills, money coming in (v127)

- **🛡️ Safe to spend today.** A chip at the top of Home. Tap it to open **More → 🤖 Autopilot**.
  - Starts from your monthly budget if you set one. Otherwise it uses your usual month's income: the median of the last 3 months, or the last 30 days while history is short. This way a salary that lands on the 30th counts for the month it pays for.
  - Takes off what you've spent and invested, the bills still due and an optional monthly **keep aside**, then spreads the rest over the days left.
  - A day never gets more than 1.5× a normal day's share. Extra money shows as **spare**, with a nudge to save it.
  - Shows whether today is over its share and what each day gets from tomorrow.
- **📅 Bills on autopilot.**
  - Finds payments that repeat about once a month in 2 of the last 3 months: EMI, LIC, phone, subscriptions. Daily habits like milk are left out.
  - Shows the usual day, a countdown (in N days / tomorrow / due / N days late) and paid-this-month.
  - Flags price changes ("▲ ₹50 more than last month").
  - Bills you know can be added by hand, or with one tap from "Looks like a bill" suggestions. × means "not a bill", with undo.
  - Settings `kharcha_autopilot_bills`, `kharcha_autopilot_hide` and `kharcha_autopilot_keep` sync across devices.
- **💼 Money coming in:** salaries and pension with their usual day and whether they've arrived.
- **🔁 Fixed costs:** the monthly and yearly cost of your bills, their share of your income, and subscriptions priced per year.
- **📈 Last 30 days vs your usual:** categories creeping up or nicely down. Tap one to search it.
- **Trip settle-up:** each "to settle" row now has **⚡ Pay** and **📲 Ask**.
  - Pay opens your UPI app with their UPI ID and the amount. The UPI ID comes from the trip link, or you type it once.
  - Ask sends a WhatsApp with your UPI pay link.
  - **✓ Settled** records the settlement.
- **Fix:** the month-end forecast no longer treats daily milk as a monthly bill.

## Fixing Autopilot mistakes (v128)

- **Remove:** tap **×** on any bill. A bill you added, or tracked from a suggestion, is removed (with Undo). A bill Autopilot found is hidden. Paid bills are under **Show paid this month**.
- **Edit:** tap a bill you added (it shows ✏️) to change its name, amount or day.
- **Restore:** **🙈 Hidden bills · restore** lists everything you hid, with a **Restore** button, so nothing hidden is lost once the Undo pop-up is gone.
- **Keep aside:** tap **Change** and enter 0 to clear it.

## Ask before save & delete, delete for everything (v129)

- **Every save asks first.** Any form that adds, saves, logs, records, creates, sets or updates something shows **"Add this? / Save this?"** with what you typed (amount, description, date…). Nothing is saved until you tap **Yes**.
  - The same goes for buttons that save straight away ("Log it", "Save & Update Balance") and one-tap suggestions.
  - Forms that don't save a record (Sign in, Open UPI app, Send on WhatsApp) don't ask.
- **Every delete asks first.** Any delete, remove, × or "Not a bill" button shows **"Delete this?"** with what it is.
  - The spend editor's "tap again to delete" is now a proper confirmation.
  - Buttons that already ask their own fuller question ask only once.
- **Delete for everything you can create:**
  - **🗑️ Delete trip** on the trip screen. Its spends go too, the friends' link is switched off, and the confirmation shows how many spends and how much.
  - **🗑️ Delete** on Projects. Its entries go too.
  - **×** on each 📍 trip check-in, with Undo.
- **Switch:** ☰ → **🛡️ Ask before save & delete** turns the confirmations on or off (setting `kharcha_confirm_actions`, synced; on by default). Undo pop-ups still work either way.
- One central check (`safety.js`) covers every page and pop-up, including ones added later.
- **Fix:** opening Trips and then tapping **+** to add a spend could make the app step "back" out of itself after saving. The back-button history now waits for a pending back step before adding a new one, and never steps back past the app's first page.

## Every bank balance at a glance, with the family account (v130)

- **🏦 Bank balances** in the top card on Home and at the top of the Bank page: every account in one card.
  - Order: ⭐ ICICI (main) first, then your other accounts (HDFC), then family accounts.
  - Each row shows a colour badge, the balance, a bar sized to it, and a 30-day **balance trail** sparkline drawn from its SMS balances.
  - The small line says when it last updated: from an SMS, or when you last typed it. A typed balance older than 7 days says "tap to update", and tapping opens that account's Update balance.
  - The total shows only **your** accounts.
- **Family account.** A bank marked "not yours" (Papa's PNB, where Mom's pension comes in) now gets its own **👵 PNB · Mom's pension** card, created by itself from its latest SMS balance and updated with every PNB SMS.
  - Its money in and out is still never counted as your income or spends.
  - Stop tracking it with ×, and it won't come back (`kharcha_family_acct_off`).
- **Fix:** an SMS from a bank that has its own account here (HDFC) now goes to that account. It used to be filed under the main account (ICICI) and moved its estimate.
- HDFC updates itself as soon as an HDFC SMS with "Avl bal" reaches the phone app. Until then it uses the balance you type.

## Salary autopilot, refund matcher, bill reminders with the paying bank (v131)

- **💼 Salary day.** When a salary lands, a card on Home (and at the top of Autopilot) shows how it lasts until the same salary comes again:
  - the bills due before then (this month's still open and next month's early ones),
  - what you keep aside (or a 20% suggestion),
  - what is free to spend, about ₹X a day.
  - One tap saves the amount to your savings goal (it asks first), or sets a monthly keep-aside.
  - "Got it" or × hides it for that salary (`kharcha_salary_seen`, synced). Other incomes still to come (Salary 2) are listed as extra.
- **↩️ Refund matcher.** A credit that says refund, reversal, reversed, chargeback or cancelled is paired with the purchase it undoes: same shop word (AMAZON, MYNTRA…), before it, within 90 days.
  - Same shop and same amount: matched by itself. Neither is counted as spending or income, with Undo.
  - A partial refund, or a same-amount credit with no shop word: asked, and "Yes, a refund" makes the spend the net amount.
  - "Not a refund" leaves it as income. It uses the same store as paybacks, so Undo works the same way.
- **🔔 Bill reminders with the paying bank.**
  - Every Autopilot bill knows which bank pays it: your choice ("Paid from which bank?" when adding or editing), else the bank its payment came from, else the main account.
  - It shows "🏦 HDFC" on the bill and warns when that bank holds less than its bills due in the next 7 days ("⚠️ HDFC has ₹3,182. Add ₹2,536 before 5 Nov").
  - A **Coming up** card on Home lists bills due within 3 days, late, or short of money, using each bill's next due date (an EMI paid on the 5th shows next month's on the 30th).
  - The phone app gets every Autopilot bill (labels like "Flat emi · HDFC (low bal)") and reminds you 2 days before and on the day.
- **Fix:** long toasts no longer shrink into a circle.

## Card bills paid through Amazon Pay / CRED (v132)

- A bank debit that pays the credit card ("Amazon Pay Cred credited", CRED, "credit card repayment", BillDesk card…) shows a **"💳 your credit card bill?"** question on Home.
  - **Yes, card bill** files it as "🔁 Credit card bill · ICICI ··1014": not a spend (the swipes already were), still money out of the bank, and "Bill paid" on the Credit card page. Undo is there.
  - **No, a spend** leaves it as it is (`kharcha_cardbill_no`).
- Questions (card bill, refund, money back, duplicates, transfers) are never folded into the "N payments due this month" line.

## 🧺 Kitchen: what each grocery spend was, and how much you use (v133)

- **Known baskets fill themselves (✨).** At a kirana or milk shop: ₹36 / ₹72 = Amul cow milk ½ L / 1 L, ₹40 / ₹80 = A2 milk ½ L / 1 L, ₹136 = 10 coffee + Amul ½ L, ₹172 = 10 coffee + Amul 1 L. Not when the description names something else ("Banana ₹40").
- **Everything else asks "🧺 What did you buy?"** from a Home card ("Fill now", one spend after another, with Skip), or from the "🧺 + items" badge on any grocery row.
  - Tap item chips (your most used first), use ± for quantity, or type it: `adrak 40, sabzi 250g 30, 10 coffee, a2 1L` (Hindi names work too).
  - Names already in the description are pre-filled ("milk and paneer").
  - Whatever isn't filled is saved as "Other". Saving asks first.
  - A basket made only of priced packs teaches the app that amount for next time.
- **☰ → 🧺 Kitchen:** per month (this, last, two ago) groceries in total and how many spends are still to fill.
  - Per item: quantity used, money, price per unit, about how much a day, how often you buy it, change vs last month, and price changes.
  - **🛒 Likely to need soon** works this out from how often you buy each item.
  - **🏷️ Pack prices** can be edited (when Amul goes up) or added.
- Items are stored in a new `expense_items` table: one row per spend, only yours (RLS), and deleted with the spend. Catalogue and learned baskets are in `kharcha_item_catalog` / `kharcha_item_patterns`.
- Home cards (salary, bills, kitchen) now live inside Home's own section, so they never show on another page.

## Vendors remember what they sell (v134)

- **The shop decides, not the description.** The vendor is read from the bank SMS ("; LAVISH KIRANA S credited" → Lavish Kirana, "SANSKRITI S STO" → Sanskriti). Different shops stay different (Vijay ≠ Vijay Hardware).
- **Before learning anything,** the name gives a first guess:
  - salon / saloon / barber → always 💇 Haircut (filled by itself)
  - vegetable / fruit / Vijay → 🥬 vegetables & fruit first
  - kirana / store / Sanskriti / Lavish / Rajbir → milk, coffee, rice, atta, dal…
  - dairy / Shree Bala Ji / Shivam → milk & paneer
- **Every saved basket teaches its shop:**
  - which items it sells (shown first next time)
  - which basket each amount means **at that shop**: ₹100 at Lavish = 10 coffee fills itself next time
  - when the same amount has meant two things (coffee or rice), it asks with both as one-tap choices ("1× here"), until one is clearly the usual (75%+)
  - a shop that has only ever sold one thing (3+ times) fills it by itself
- **🏪 Your vendors** (Kitchen page): each shop with what it sells, what it learned from, and this month's spend. Tap to set "Sells" or "Always", × to forget what it learned (Undo). Stored in `kharcha_vendors`, synced.
- **🧺 What was it?** in any spend's edit form, so any shop can learn, not only grocery ones.
- A description that is only the shop's name is no longer read as an item.

## "What did you buy?" fits the phone (v135)

- The sheet has a fixed header and a fixed **Skip / Save items** bar; only the middle scrolls. It no longer squeezes everything into a short screen.
- It sizes itself to the space **above the phone keyboard**, and whatever you type into scrolls into view. The type box sits near the top, right under the items.
- 10 item chips, then **More ▾**. Item rows fit 320–360px phones. Inputs use 16px text, so phones don't zoom.
- No blurred backdrop, which rendered badly in the Android app.
- **Fix:** "Shree Bala Ji milk and paneer" pre-fills milk and paneer again. Only the shop's own words are ignored.
