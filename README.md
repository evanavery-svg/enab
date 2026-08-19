# ENAB

A zero-based envelope budgeting app, built as an installable PWA that runs
entirely on your device. Give every dollar a job, spend from envelopes rather
than from a balance, and settle overspending month by month instead of letting
it disappear.

Transactions are entered by hand — there's no bank sync, no account, no server.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

To build and serve the production bundle (the one with the service worker):

```bash
npm run build
npm run preview    # http://localhost:4173
```

**Don't open `dist/index.html` by double-clicking it.** Browsers block
JavaScript modules on `file://` pages, so the app can't start — it has to be
served over http. ENAB detects this and says so rather than showing a blank
page, but the fix is always to use `npm run dev`, `npm run preview`, or a real
host.

### Publishing it (GitHub Pages)

The repo ships a workflow that builds and publishes the app for you.

1. On GitHub: **Settings → Pages → Source: GitHub Actions**.
2. Push. The workflow runs the tests, builds, and publishes `dist/`.
3. Open the URL Pages shows you.

> **Do not choose "Deploy from a branch."** That publishes the repository
> root, and the root `index.html` is the *development* entry point — it points
> at `src/main.tsx`, which is TypeScript no browser can run. The page comes up
> reporting that it can't load `main.tsx`. Only the contents of `dist/` are a
> working app, which is exactly what the workflow uploads.

Any other static host works the same way: build, then upload `dist/`. The build
uses relative paths, so serving from a subdirectory (like
`yourname.github.io/enab/`) is fine.

### Putting it on your phone

On first open ENAB offers step-by-step instructions for adding itself to your
Home Screen, matched to the device you're on. It shows once, never when you're
already running the installed app, and can be reopened from Settings → *Add to
your Home Screen*.

Open the published URL on your phone — it must be **https** (or `localhost`),
because service workers won't install otherwise.

- **iOS:** Share → *Add to Home Screen*
- **Android:** menu → *Install app*

It then behaves like a native app: full screen, its own icon, works with no
connection.

Your budget is stored in that browser's IndexedDB. It never leaves the device,
which also means **nothing is backed up for you** — use Settings → Back up
regularly and keep the JSON somewhere safe.

### Versioning

The patch number in `package.json` is bumped on every change, and the version
shows in full at the bottom of the sidebar and the More tab. That is how you
tell at a glance whether the installed app has actually picked up a new build:
if the footer still reads the old number, the update has not landed yet.

### Updates

The installed app updates itself. A new build activates immediately rather than
waiting for tabs to close, and ENAB re-checks for one every time the app comes
back to the foreground — which is what actually matters on a phone, where an
installed app is resumed rather than reloaded. When a new version is found the
app reloads itself once, on the spot. Nothing is lost: everything is already
written to the database.

So the update flow is just: upload a new `dist/`, then open the app.

## How the budget works

The rules are the ones that make envelope budgeting actually add up.

**Ready to Assign** is the money you have but haven't given a job yet:

```
Ready to Assign = last month's leftover
                + income this month
                − everything assigned this month
                − cash overspending from last month
```

Money assigned to a future month doesn't reduce the current month — it's shown
separately in the Ready to Assign breakdown.

**Each category** holds `carried over + assigned + activity`. A positive balance
rolls forward untouched. A negative one is split in two, because the two kinds of
overspending are genuinely different:

- **Cash overspending** — you spent money that had already left a checking
  account. The category resets to zero and next month's Ready to Assign is
  reduced. The debt is settled; it just came out of next month's money.
- **Credit overspending** — you charged something you never funded. The negative
  balance rolls forward in the category itself, because that debt is still real
  and still unbudgeted.

**Credit cards** each get their own payment category. When you charge something
to a card and the spending category had money in it, that money moves into the
card's payment category, ready for the bill. Pay the card and it spends back out.
Refunds move money back the other way. The upshot: the payment category always
shows what you can actually afford to pay.

**Age of Money** is how long the dollars you most recently spent sat in your
accounts first. Income is a FIFO queue; every expense drains it from the oldest
end. Past 30 days means this month's spending is coming from last month's income.

## Auto-Budget

Import a CSV of your history and ENAB will work out what to budget, from what
you actually spent.

**Finding what repeats.** Charges are grouped by payee and checked for a rhythm:
the gaps between them, and how much the amount moves. Three occurrences is the
floor — two dates make a line through any coincidence. A charge that lands on a
schedule for about the same amount each time is a subscription; one that lands
on a schedule for a different amount each time is a bill (your electricity);
shopping at the same place most weeks is neither. Each is reported with its real
cost per month and per year, whatever its actual cadence — a $60 quarterly
charge is $20 a month. Subscriptions that stopped charging are listed
separately, because those are the ones worth knowing you cancelled.

**Proposing the plan.** Each category's suggestion comes from the *median* of
past months rather than the average, so one holiday or one car repair doesn't
permanently inflate it. Categories that only fire occasionally — gifts, car
maintenance — are spread across the window instead, since their median is
usually zero. Steady subscriptions set a floor: one you haven't cancelled will
be charged whether or not last month happened to be quiet. Variable charges
deliberately don't set a floor, because the historical median already counts
them.

Every suggested amount is editable, any category can be excluded, and the plan
tells you whether it fits inside a typical month's income before you apply it.
Applying assigns the amounts; optionally it also creates a monthly target for
each category.

## Features

**Budgeting** — monthly envelopes, Ready to Assign, move money between
categories, cover overspending, category groups you can add, rename, hide or
delete, hideable categories, notes, and per-month history reaching back to your
first transaction.

**Targets** — needed-for-spending (weekly, monthly, yearly, or every N
months/years, as *refill up to* or *set aside another*), savings balance,
savings by a date, and debt payoff. Multi-month targets spread the remainder
evenly over the months left; weekly targets ask for five payments in a
five-payday month.

**Auto-assign** — underfunded, assigned last month, spent last month, average
assigned, average spent, reset to zero — applied to one category or all of them.

**Accounts** — checking, savings and cash on budget; credit cards and lines of
credit with payment categories; mortgages, loans, investments and other assets
tracked off budget for net worth.

**Transactions** — splits across categories, transfers between accounts (with
both legs kept in step), payees that remember their usual category, flags,
cleared/uncleared/reconciled states, running balances, search and filters, and
bulk edits.

**Scheduled transactions** — thirteen frequencies, auto-entered when due. Close
the app for a month and it catches up on next open.

**Reconciling** — enter what the bank says, and any difference becomes a visible
adjustment transaction rather than a silent edit. Reconciled rows lock.

**Reports** — spending by category or group, income versus spending, spending
over time, net worth, and Age of Money, over any range from three months to all
time.

**Auto-Budget** — import a CSV of past transactions and ENAB proposes a plan
(see below), and lists the charges that repeat.

**Everything else** — light/dark/system themes, currency and number formats,
CSV import from bank exports with column matching, CSV export, full JSON backup
and restore, and Fresh Start.

## Tests

```bash
npm test           # unit tests: budget engine, targets, analysis, money parsing
npm run test:e2e   # browser tests, needs `npm run preview` running
```

The unit tests cover the parts where a mistake would quietly cost you money —
rollover, the two kinds of overspending, credit card payment categories,
transfers, splits, target maths, recurrence, amount parsing, and the analysis
behind Auto-Budget. The end-to-end suites drive the real UI: budgeting a month,
charging a card, reconciling, splitting, scheduling, a backup/restore round
trip, and importing a CSV to plan from. A fourth suite covers phone behaviour
that is easy to break and hard to spot: the app shell staying pinned while a
list scrolls, and no form field dipping under the size that makes iOS Safari
zoom the page in.

If Chromium lives somewhere unusual, point at it:

```bash
PLAYWRIGHT_CHROMIUM=/path/to/chrome npm run test:e2e
```

## Layout

```
src/
  budget/     the engine: envelope maths, targets, recurrence, analysis
  db/         Dexie schema, seed data, and every mutation
  components/ shared UI — modals, fields, charts, the transaction editor
  pages/      budget, accounts, register, reports, payees, scheduled, settings
  lib/        money, dates, CSV, backup
  styles/     design tokens and stylesheets
e2e/          browser test suites
scripts/      icon generation (no image dependencies — raw PNG encoding)
```

Amounts are integer cents everywhere. Dates are `YYYY-MM-DD` and months are
`YYYY-MM`, both in local time — a budget is lived locally, not in UTC.
