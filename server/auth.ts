import { createHmac, timingSafeEqual } from 'node:crypto';

// Single-user sign-in: one password (APP_PASSWORD), exchanged for a signed, HttpOnly session
// cookie. No accounts table, nothing to reset — and nothing works at all until both secrets
// are set, rather than the app quietly running open.

const COOKIE = 'ht_session';
const MAX_AGE_S = 60 * 60 * 24 * 30;

function secret(): string {
  const v = process.env.SESSION_SECRET?.trim();
  if (!v || v.length < 16) throw new AuthConfigError('SESSION_SECRET is not set (use 32+ random characters).');
  return v;
}

export class AuthConfigError extends Error {}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkPassword(given: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) throw new AuthConfigError('APP_PASSWORD is not set.');
  // Compare HMACs so the comparison is constant-time regardless of length.
  return safeEqual(sign(`pw:${given}`), sign(`pw:${expected}`));
}

export function sessionCookie(secure: boolean, now = Date.now()): string {
  const exp = String(Math.floor(now / 1000) + MAX_AGE_S);
  const value = `${exp}.${sign(`session:${exp}`)}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure ? '; Secure' : ''}`;
}

export function clearCookie(secure: boolean): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function isSignedIn(cookieHeader: string | null, now = Date.now()): boolean {
  if (!cookieHeader) return false;
  const match = cookieHeader.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!match) return false;
  const [exp, sig] = match.slice(COOKIE.length + 1).split('.');
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) * 1000 < now) return false;
  return safeEqual(sig, sign(`session:${exp}`));
}

/** Vercel's scheduler sends `Authorization: Bearer <CRON_SECRET>`. */
export function isCron(authHeader: string | null): boolean {
  const s = process.env.CRON_SECRET?.trim();
  return Boolean(s) && safeEqual(authHeader ?? '', `Bearer ${s}`);
}
