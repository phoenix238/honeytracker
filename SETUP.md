# Honey — setup

About 30 minutes, once.

## 0. The Vercel project (3 min)

vercel.com → **Add New… → Project** → import `phoenix238/honeytracker` → Framework
preset **Vite** (detected) → **Deploy**. It will show a setup screen until steps 1–2 are
done. Every push to `main` redeploys; every branch gets a preview URL.

Everything below is an **environment variable** in Vercel → the project → Settings →
Environment Variables. After adding any, redeploy (Deployments → ⋯ → Redeploy).

## 1. Database (5 min) — required

Vercel → the project → **Storage → Create → Neon (Postgres)** → connect it to the
project. That sets `DATABASE_URL` for you. (Or create a project at neon.tech, region
London, and paste its pooled connection string as `DATABASE_URL`.)

The tables create themselves on first use.

## 2. Sign-in (1 min) — required

| Variable | Value |
|---|---|
| `APP_PASSWORD` | The password you'll sign in with. Make it long. |
| `SESSION_SECRET` | 32+ random characters — https://generate-secret.vercel.app/32 |

## 3. Starling bank feed (5 min)

1. https://developer.starlingbank.com → sign in → **Personal Access** → create a token
   with read access to: `account:read`, `account-list:read`, `transaction:read`.
   (Read-only. It cannot move money.)
2. `STARLING_TOKEN` = the token. For several accounts (e.g. personal + business), use
   `STARLING_TOKENS` = the tokens separated by commas.

The first sync reaches back to the start of **last** tax year, because last year's bill
sets this year's payments on account.

## 4. Daily automatic sync (1 min)

`CRON_SECRET` = another random value. Vercel then runs the sync every morning at 05:00
UTC (`vercel.json`). You can always press **Sync now** on Home too.

## 5. Receipt reading (3 min)

`ANTHROPIC_API_KEY` = a key from https://console.anthropic.com (the CSTL one works).
Without it, receipts are still stored; you just type the total and date yourself.
Optional: `RECEIPT_MODEL` to choose a different Claude model.

## 6. Link CSTL (3 min)

See CSTL's SETUP.md step 10: the same random value goes in CSTL as
`FINANCE_API_TOKEN` and here as `CSTL_FINANCE_TOKEN`, plus `CSTL_URL` = the CSTL app's
address.

## 7. First run

1. Open the app → sign in → **Settings → Income streams**: add one per kind of work
   (e.g. "CSTL practice", "Freelance"). Tick "CSTL session income goes here" on the
   practice one.
2. **Home → Sync now.**
3. **Settings → Bring in old records** → import the Honeypot0101 backup file
   (in the old app: Settings → Export backup).
4. **Tax** → fill in "What the bank can't tell me": last year's Self Assessment bill
   (from HMRC's calculation), any PAYE job, anything already paid to HMRC.
5. **Money → Review**: classify what's waiting. Tick "Always do this" on anything
   regular — room hire, software, the same clients — and it sorts itself from then on.

## On your phone

Open the URL in Safari → Share → **Add to Home Screen**. Snap receipts from there.

## Weekly habit (5 minutes)

Money → Review until it's empty, and snap any receipts the Home screen asks for. That's
the whole job; the Tax tab is then always ready.
