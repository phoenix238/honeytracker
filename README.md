# Honey Tracker

Phoenix's finance hub. The bank feed is the backbone: every transaction lands in one
ledger, you say what each one is, and the tax return adds itself up as you go.

## How it fits together

```
 Starling (all accounts) ──┐
 CSTL paid sessions ───────┤     ONE LEDGER (Postgres)            OUT
 Cash you type in ─────────┼──►  every row: business income /  ──► Tax pot target + set-aside %
 Receipts (snap / upload) ─┘     cost (HMRC category) /            HMRC payment calendar
                                 personal / transfer, a stream,    SA103 figures per stream
                                 and its receipt                   MTD quarterly figures
                                                                   CSV for an accountant
```

- **CSTL** runs the practice and owns nothing tax-related. It exposes a money-only feed
  (`/api/finance/events`); Honey uses the Starling transaction id to label the bank row
  it already has, adds cash sessions, and lists card/other ones for you to decide.
- **Honeypot0101** is retired: import its "Export backup" file once (Settings → Bring in
  old records). Records are matched to their bank lines, not added twice.

## Principles

- **Store facts, derive numbers.** Rows hold what happened and how you classified it —
  never a frozen tax figure. `src/core/ledger.ts` and `src/core/ukTax.ts` derive every
  number on read, so changing a classification or a setting fixes every total at once.
- **Money is integer pence.**
- **The bank is the record.** Bank rows can't be deleted or edited, only classified;
  cash and typed rows are the only ones you can change. Every classification change is
  kept in an audit log (Money → a row → Show change history).
- **Real tax, not a flat 20%.** Personal allowance and its taper, 20/40/45% bands,
  Class 4 NI, a PAYE job, the £1,000 trading allowance, and payments on account — the
  thing that makes January hurt. England/Wales/NI rates; limits are listed on the Tax tab.
- **Nothing fails silently.** Every save waits for the server and shows its error.
  Receipts snapped with no signal wait on the phone and upload by themselves.

## Stack

Vite + React + TypeScript (strict). One Vercel Function (`api/index.ts` → `server/router.ts`)
serves the whole API. Postgres on Neon in production; PGlite (Postgres in WASM) locally
and in tests, so the tests run the production SQL. Receipts are read by Claude.

```
npm install
npm run dev        # app + API + a local Postgres in .data/ — set APP_PASSWORD and
                   # SESSION_SECRET in .env.local first
npm test           # core tax/ledger logic + the API end to end
npm run typecheck
npm run build
```

## Layout

- `src/core/` — pure, framework-free, tested: `types` (the ledger model), `ukTax` (the tax
  engine), `ledger` (every derived figure), `hmrc` (categories ↔ MTD fields ↔ SA103 boxes),
  `rules`, `receiptMatch`, `importers`, `exportCsv`, `dates`, `money`.
- `server/` — `router` (the API), `repo` (all SQL), `schema`, `sync` (Starling + CSTL),
  `starling`, `receipts` (Claude), `auth`.
- `src/ui/` — the app: Home, Money (inbox), Receipts, Tax, Settings.

Setup and deployment: **[SETUP.md](./SETUP.md)**.
