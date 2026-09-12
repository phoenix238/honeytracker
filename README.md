# Honey Tracker

Freelance finance tracker — a ground-up rebuild of Honeypot0101, learning from its mistakes.

## Principles

- **Store facts, derive numbers.** Records hold gross amounts and dates — never a frozen
  `tax` or `net`. Every derived figure (tax stash, take-home, taxable profit) is computed on
  read from the current settings by `src/core/tax.ts`. This is why the old app's tax-rate
  setting silently did nothing and old records stayed wrong: it stored derived numbers in a
  dozen places. Here there is one derivation, applied live.
- **Money is integer pence, never a float.** Removes the rounding class of bugs (the old
  app compared amounts with a `< 0.02` tolerance to hide them).
- **Money-first, not invoice-first.** Income counts on its own — from the bank feed or as
  cash — with or without an invoice. Invoices and receipts are optional documents, not the
  gatekeeper for income to be counted.
- **Local-first.** The device is the fast, authoritative copy; a confirmed cloud backup
  (planned) provides cross-device sync and safety. See "Roadmap".

## Stack

Vite + TypeScript (strict) + React. Pure, tested domain logic in `src/core/`; UI in
`src/ui/`.

```
npm install
npm run dev        # local dev server
npm test           # vitest — the accuracy guarantee for all money logic
npm run typecheck
npm run build      # production build (base path /honeytracker/ for GitHub Pages)
```

## Layout

- `src/core/` — pure, framework-free, fully tested:
  - `types.ts` — the domain model (facts, not derived numbers)
  - `money.ts` — integer-pence parsing, formatting, arithmetic
  - `dates.ts` — UK tax-year boundaries (6 Apr–5 Apr) and helpers
  - `tax.ts` — the single derivation of every money figure from facts + settings
  - `duplicates.ts` — grouped duplicate detection (ported and proven equivalent)
- `src/ui/` — React screens. Currently a minimal Home that derives totals live from sample
  facts, demonstrating the store-facts/derive-numbers principle end to end.

## Roadmap

Phase 1 (this scaffold): project + tested core logic + a minimal Home. Next:

1. **Storage** — IndexedDB repository (device-authoritative), photos in IndexedDB from day
   one (never localStorage — that quota overflow silently lost saves in the old app).
2. **Confirmed cloud sync** — Cloudflare Worker + D1, writes that report success or a
   visible error, never a silent failure.
3. **Full UI** — built from the agreed information architecture (four objects; Home / Money
   / Documents / More; bank and cash income pathways).
4. **Importer** — one-time migration from the old app's data.
