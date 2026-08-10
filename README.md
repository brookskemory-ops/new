# Ledger

A personal finance tracker that runs on your own machine. Track expenses,
categorize them, set budgets, sync your bank automatically, and get an AI
read on where your money is going.

Your data lives in a SQLite file on your disk. There is no account, no server,
and nothing is uploaded — except the optional integrations below, which you turn
on yourself and which are described precisely so you know what leaves the
machine.

---

## Get it running (2 minutes)

You need [Node.js 20 or newer](https://nodejs.org).

```bash
npm install
npm run seed     # optional: six months of realistic demo data
npm run dev
```

Open **http://localhost:3000**.

`npm run seed` fills the app with a fictional person's finances so you can see
what everything does before entering anything real. When you're ready for your
own numbers:

```bash
npm run reset    # wipes all data, keeps the app set up
```

---

## Getting your real finances in

Three ways, and they work together. Start with the first.

### 1. Import a statement file (works right now, no signup)

Every bank and credit card lets you export transactions. Download the last 3–6
months, go to **Accounts → Import a statement**, pick the account, and drop the
file in. CSV and **Quicken (.qfx) / Money (.ofx)** both work, detected from the
file's contents rather than its extension.

**Prefer .qfx or .ofx if your bank offers it** — usually the button right next
to the CSV one. Those formats carry `FITID`, a unique id the bank assigns each
transaction, which makes re-importing overlapping statements exact instead of a
guess. If you already imported a period as CSV and then import the same period
as QFX, the earlier rows adopt their ids rather than duplicating.

Date, amount, and description columns are detected automatically. All three
common export shapes work unchanged:

- a single signed `Amount` column (Chase, Amex, most cards)
- separate `Debit` / `Credit` columns (Bank of America, many credit unions)
- an unsigned amount plus a `Type` column saying DEBIT or CREDIT

Re-importing a statement that overlaps one you already imported is safe —
matching rows are detected and skipped, so you never get doubles.

**This is the fastest path to a useful app, and it costs nothing.** Do this
first even if you plan to link your bank.

### 2. Add transactions by hand

The form on the dashboard. Useful for cash, for splitting a shared bill, or for
anything your bank labels uselessly.

### 3. Link your bank for automatic sync (optional, paid)

Two options, both supported. **[SimpleFIN](#bank-sync-simplefin)** is the one
built for individuals — no developer account, no business application, a couple
of dollars a year. **[Plaid](#bank-sync-plaid)** is the industry standard but is
aimed at companies, so it requires an application before it works with real
banks.

You can use either, or both, or neither.

---

## Categorization

Every transaction gets a category automatically, using ~180 built-in merchant
rules (Trader Joe's → Groceries, Netflix → Subscriptions, and so on).

**When it gets one wrong, fix it in the transaction list.** You'll be asked
whether that merchant should always use the new category. Say yes and a rule is
saved, then applied to every matching transaction you already have. The
categorizer gets better the more you correct it.

Anything unmatched lands in **Uncategorized** rather than being hidden — the
dashboard tells you how many need attention, because an uncategorized expense
still counts toward your total but not toward any budget.

Two things it deliberately gets right that most trackers get wrong:

- **Transfers between your own accounts are not spending.** Moving $600 from
  checking to savings isn't $600 spent.
- **Credit card payments are not spending either.** When you buy groceries on a
  card, that's already recorded as grocery spending. Counting the payoff too
  would double every dollar you put on plastic. Loan payments are *not* treated
  this way — a student loan payment is real money you have to find every month,
  so it stays in your spending.

---

## Accounts

Each account has a **type**, and it matters beyond labelling: checking,
savings, cash, and investment accounts count *toward* net worth, while credit
cards and loans count *against* it.

Bank sync has to guess the type, because the feed carries only a name — and
banks send the product name ("Sapphire Preferred", "Quicksilver", "Discover
it") with no generic word like "card" in it. The guesser knows the common card
brands, but it will still get one wrong eventually.

**When it does, change the type in the dropdown on the Accounts page.** Net
worth updates immediately. That dropdown is the real fix; the guessing is just
there to save you the work most of the time.

### Manual accounts move with their transactions

For accounts nothing syncs into — cash, or a bank you import by hand — the
balance is **derived**: an opening balance plus every transaction recorded
against it. Spend $45 from a $200 wallet and it reads $155 without you touching
anything.

This was worth fixing properly. Storing a balance and a transaction list
separately means they drift the moment you record anything, and a balance that
lies is worse than no balance at all.

### Reconciling

Cash never matches exactly. You buy a coffee and forget. On the Accounts page,
**Reconcile** takes what the account *actually* holds and records the gap as a
visible transaction — "Balance adjustment · Cash spent but not recorded" —
rather than silently rewriting the number.

The difference matters: a rewritten balance hides that you spent $35 you can't
account for. A ledger entry keeps it in your spending totals, where it belongs.

---

## Cash on hand

Cash is the spending that goes unrecorded and quietly breaks every other total.
The dashboard has a **Cash on hand** card for it: an amount, what it was for,
and it's in. No date picker, no category dropdown, no account selector unless
you keep more than one wallet.

That minimalism is the whole point. A six-field form does not get filled in at
a coffee counter, and a roughly-recorded expense beats one you never entered.
Categorization runs on what you typed, so "lunch" files itself.

Press **Track cash** the first time to create the wallet with what's in your
pocket right now.

---

## Budgets

Set a monthly amount per category on the **Budgets** page. Leave the checkbox
alone and it repeats every month; tick it to override a single month. Set a
budget to 0 to remove it.

Budgets are judged **against how far into the month you are**, not against a
flat line. Spending 60% of your grocery budget is fine on the 25th and a
problem on the 5th — so the meter says "On track" or "Spending fast" based on
the date, and the thin vertical line marks where you should be by now.

If you don't know what to set, each category offers a suggestion based on your
own median spending over the last six months, rounded to the nearest $5. A
budget you've never once hit is a budget you'll ignore.

---

## Forecast

Every other page reports the past. This one looks forward, and it is the part
most worth checking before you spend money.

**Safe to spend** is the headline: what is in checking and cash, minus every
bill already committed before your next paycheck lands. The arithmetic is shown
next to it, because a number like this is only worth trusting if you can see
where it came from. Savings is excluded on purpose — it is money you decided
not to spend, and counting it would quietly tell you a bill is covered when
covering it means raiding the emergency fund.

**Projected balance** draws two lines. The solid one applies your usual
day-to-day spending, measured from the last 90 days; the dashed one applies
only bills and income. The dashed line always slopes upward — that is exactly
why it is not the one you read. The lowest point is called out, since that is
the moment something bounces.

**What is coming** lists detected commitments with their next due date. A
charge only qualifies if it repeats at a consistent interval *and* a consistent
amount. That combination is what keeps groceries out: a supermarket you visit
twice a month has the same *average* gap as a subscription and nothing like the
same rhythm. It also means the list stays empty until you have roughly three
months of history — an honest empty state beats a confident wrong one.

**Quiet price rises** flags recurring charges that went up without telling you,
comparing the latest charge against what that merchant used to bill, and totals
what the increases cost you per year. Streaming services do this constantly.

**What happened to your raise** finds a step change in income and measures how
much of it went straight back out as higher spending. A raise that is fully
absorbed leaves you exactly where you were, which is easy to miss month to
month and obvious across the boundary.

---

## Goals

The **Goals** page tracks what you're saving toward — an emergency fund, a
deposit, a trip — and answers the only question that matters about a goal:
*when.*

The date comes from your **median saving month over the last six months**, not
from what you intend to save. The median specifically: one windfall month
shouldn't promise a date you'll never hit, and one bad month shouldn't say
never. If the honest answer is "not at this rate", it says that rather than
inventing a date.

Update the saved amount as it grows and the projection moves with it.

---

## Bank sync (SimpleFIN)

Optional. Probably the one you want.

SimpleFIN is an aggregator built for individuals rather than companies. There's
no developer account, no business application, and **nothing goes in `.env`** —
you link your banks on their site, paste a one-time token into the app, and
you're done.

### Setup

1. Go to **[SimpleFIN Bridge](https://beta-bridge.simplefin.org/)** and create
   an account.
2. Connect your banks there.
3. Create a **Setup Token** for this app.
4. In Ledger: **Accounts → SimpleFIN → Connect**, paste the token, press
   Connect.

That's it. It pulls the last 90 days — SimpleFIN's maximum — and after that
**Sync now** fetches anything new. For older history, export a CSV from your
bank and import that; the two sit side by side without duplicating.

The Setup Token works exactly once. If you paste it twice, or it errors and you
retry, generate a fresh one — the app will tell you if that's what happened.

### What it costs

SimpleFIN charges a small annual subscription (single-digit dollars per year at
the time of writing) rather than a per-account monthly fee. Check their site
for the current number.

### Why this is nicer than CSV or Plaid

- **Exact duplicate detection.** Every transaction carries a stable ID from the
  bank, so re-syncing can never produce a double. CSV import has to infer this
  from date + amount + description.
- **Corrections stick.** If you recategorize something by hand, later syncs
  update the amount and description if the bank revised them, but never touch
  your category.
- **No approval process.** Unlike Plaid, you can use it with your real bank
  today.

### Notes

- **Pending transactions are imported.** Many institutions — credit unions
  especially — leave a charge pending for days, so excluding them makes the most
  recent activity look missing. A pending charge is later replaced by a posted
  one carrying a *different* ID, so pending rows the feed stops returning are
  pruned automatically. You never end up with both.
- **If a bank looks like it is missing history, press "Full re-pull."** Normal
  syncs only fetch a short recent window. A bank connected at SimpleFIN *after*
  your first sync gets a full-year backfill automatically, but the button is
  there for anything else.
- Each sync reports what every account returned, so a bank sending nothing is
  visible rather than silent.
- **If one bank syncs and another doesn't, press "Diagnose."** It fetches the
  feed read-only and shows exactly what SimpleFIN sent: which institutions are
  attached, how many transactions each account returned and over what dates,
  any accounts stored here that the feed stopped returning, and SimpleFIN's own
  errors *with the bank name attached*. Nothing in this app filters
  transactions out, so an account showing zero means SimpleFIN sent zero —
  usually an institution that needs re-authorising on their site.
- Your Access URL is the credential — it embeds a username and password. It's
  stored only in your local database and never sent anywhere except SimpleFIN.
- **Disconnect** deletes the connection and everything it imported. It does
  *not* cancel your SimpleFIN subscription — do that on their site.

---

## Bank sync (Plaid)

Optional. Everything else works without it.

Plaid is the service that connects apps to banks — it's what Venmo, Robinhood,
and most budgeting apps use. You'll need your own account.

### Setup

1. **Sign up** at [dashboard.plaid.com/signup](https://dashboard.plaid.com/signup).
   Free, no credit card.
2. **Copy your keys** from Team Settings → Keys. You want `client_id` and the
   **Sandbox** secret to start.
3. **Create your `.env`:**
   ```bash
   cp .env.example .env
   ```
   Fill in:
   ```
   PLAID_CLIENT_ID=your_client_id
   PLAID_SECRET=your_sandbox_secret
   PLAID_ENV=sandbox
   ```
4. **Restart the dev server** (env vars are only read at startup).
5. Go to **Accounts → Link a bank**. In sandbox, pick any bank and log in with
   username `user_good`, password `pass_good`. You'll get fake transactions —
   proof the whole pipeline works.

### Going live with your real bank

Sandbox uses fake data. For your actual accounts you need Production access:

1. In the Plaid dashboard, request Production access. You fill in a short form
   about your use case — "personal use, single user, personal finance tracking"
   is accurate and is approved routinely. Approval typically takes a day or two.
2. Copy your **Production** secret, set `PLAID_SECRET` to it and
   `PLAID_ENV=production` in `.env`, restart, and link your bank for real.

### What it costs

Plaid bills per connected item (one bank login) per month. As of now their
published pay-as-you-go rate is **around $0.30 per connected account per
month** for transactions, with a small monthly minimum — so one or two banks is
typically a couple of dollars a month, not more. **Check
[plaid.com/pricing](https://plaid.com/pricing) before committing**, since these
figures change and I'd rather you see the current number than trust one written
into a README.

If you'd rather not pay anything, CSV import gives you the same data for the
cost of a two-minute download each month.

### Security

Your Plaid access token is stored in the local SQLite file and never leaves
your machine. `.gitignore` excludes both `.env` and `data/`. Unlinking a bank
from the Accounts page also tells Plaid to invalidate the connection, so it
stops being billed — **unlink from the app rather than just deleting the
database**, or the connection stays open on Plaid's side.

---

## AI insights (Anthropic)

Optional. Everything else works without it.

The **Insights** page sends your monthly figures to Claude and gets back
specific observations, ranked recommendations, and suggested budgets.

### Setup

1. Get a key at
   [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys).
   It's pay-as-you-go — no subscription, and it is a *separate* thing from a
   Claude.ai chat subscription.
2. Add credit (the minimum is $5, which is far more than this app will use).
3. Save it:
   ```bash
   npm run set-key ANTHROPIC_API_KEY
   ```
   It prompts for the key, hides it as you type, and writes it to `.env` for
   you. (You can edit `.env` by hand instead if you prefer.)
4. Restart the dev server.

### What actually gets sent

Only aggregates:

- category totals for the month
- budgets and how much of each you've used
- recurring charge amounts
- your six-month income/spending trend
- the needs / wants / saved split

**Individual transactions, dates, merchant-level detail, account numbers, and
your name are never sent.** The model gets the shape of your month, not your
life.

### What it costs

A few cents per analysis. Results are cached against the exact numbers
analyzed, so re-opening the Insights page is free — a new call only happens
when your data actually changed or you click "Run a fresh analysis".

Set `ANTHROPIC_MODEL=claude-sonnet-5` in `.env` if you want it cheaper; the
default is `claude-opus-5`, which gives noticeably better financial reasoning.

### Ask a question

Below the analysis on the same page is a chat box. Ask things the dashboard
doesn't have a tile for — *"how much do I spend on coffee?"*, *"can I afford a
$400 purchase this week?"*, *"which subscriptions should I cancel?"*

It works differently from the analysis above it, and the difference is the
point. Rather than sending a summary and hoping the answer is in it, Claude is
given **seven read-only lookups** — month summary, category breakdown, merchant
search, monthly trend, recurring commitments, cash position, top merchants —
and fetches only what your question needs. Ask about Starbucks and it pulls one
merchant total; it never sees the rest of your ledger.

Every lookup returns aggregates. **None of them return a transaction list**, so
individual dates, amounts, and payees stay on the machine — the same posture as
the analysis above.

Which lookups were consulted is printed under each answer. An answer about
money that you cannot trace back to a figure is not worth much.

Roughly a cent a question. Follow-ups work — "what about last month?" resolves
against what you just asked.

---

## Project layout

```
src/
  app/
    page.tsx            Dashboard
    transactions/       Searchable, editable transaction list
    budgets/            Budget editor with history-based suggestions
    forecast/           Safe-to-spend, projections, recurring commitments
    goals/              Savings goals with rate-based arrival dates
    accounts/           Accounts, bank sync, CSV and OFX/QFX import
    insights/           AI analysis and the ask-a-question chat
    api/                JSON API behind all of the above
  components/           React components (Charts.tsx has the SVG charts)
  lib/
    schema.sql          Database schema, commented
    db.ts               Connection, migrations, default categories and rules
    money.ts            Money and date handling — read this one first
    categorize.ts       Rule-based auto-categorization
    queries.ts          Every read the UI needs
    plaid.ts            Bank sync via Plaid
    simplefin.ts        Bank sync via SimpleFIN
    ai.ts               Claude integration
    chat.ts             Ask-a-question tools and the tool-use loop
    csv.ts              CSV import and merchant-name cleanup
    ofx.ts              OFX / QFX statement parsing
    forecast.ts         Recurrence detection and forward projection
scripts/
  seed.ts               Demo data
  reset.ts              Wipe data
data/ledger.db          Your finances (gitignored)
```

### Two conventions worth knowing before you edit anything

**Money is always an integer number of cents.** Never a float, anywhere.
`0.1 + 0.2 !== 0.3` is not a problem you want in a ledger. Conversion happens
only in `src/lib/money.ts`.

**Negative means money left you.** A positive amount is income or a refund.
This means summing any set of transactions gives you net cash flow directly.
Plaid uses the opposite convention and is flipped once, at the boundary, in
`src/lib/plaid.ts`.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app at localhost:3000 |
| `npm run build` | Production build |
| `npm start` | Run the production build |
| `npm run seed` | Load six months of demo data |
| `npm run reset` | Delete all financial data |
| `npm run set-key` | Save an API key to `.env` without opening a text editor |
| `npm run typecheck` | Type-check without building |

---

## Backing up

Your entire financial history is one file: `data/ledger.db`. Copy it somewhere
safe periodically. To restore, put it back and start the app.

Don't commit it — `.gitignore` already excludes `data/`, and you should keep it
that way even for a private repo.

---

## Notes and limits

- **Single user, single machine.** There's no authentication, because the app
  only listens on localhost. Don't expose it to the internet as-is.
- **USD only.** Amounts are formatted as US dollars throughout. Supporting
  other currencies means changing `src/lib/money.ts` and adding a currency
  column to the queries.
- **Recurring-charge detection needs history.** It looks for merchants charging
  a steady amount in 3 of the last 4 months, so it stays empty until you have a
  few months of data.
- **AI output is a starting point, not advice.** It reasons from the numbers you
  gave it and knows nothing else about your situation.
