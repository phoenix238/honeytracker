// Gmail OAuth + read access. The access/refresh tokens live only in this device's IndexedDB
// (under their own meta key, never inside Settings) so they're never swept up by the JSON
// backup export — a backup file is meant to be shareable/storable, a live Gmail token isn't.
//
// The client ID is public (Google's own model for browser apps); the client secret never
// leaves the server — see api/auth/google/token.ts for the exchange.

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/userinfo.email'].join(' ');

export interface GoogleAuth {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  email?: string;
}

export function buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function fetchUserEmail(accessToken: string): Promise<string | undefined> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return undefined;
  const data = await res.json();
  return data.email;
}

/** True once the token is within 60s of expiring — refresh a little early rather than racing it. */
export function isExpired(auth: GoogleAuth): boolean {
  return Date.now() > auth.expiresAt - 60_000;
}

export interface GmailCandidate {
  id: string;
  snippet: string;
  text: string;
}

/** Searches Gmail for receipt/invoice-shaped mail and returns each message's plain-text body. */
export async function searchReceiptEmails(accessToken: string, maxResults = 15): Promise<GmailCandidate[]> {
  const query = '(receipt OR invoice OR "order confirmation" OR "payment confirmation") newer_than:90d';
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q: query, maxResults: String(maxResults) })}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!listRes.ok) throw new Error(`Gmail search failed: ${listRes.status}`);
  const list = await listRes.json();
  const ids: string[] = (list.messages ?? []).map((m: { id: string }) => m.id);

  const messages = await Promise.all(
    ids.map(async (id) => {
      const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;
      const msg = await res.json();
      return { id, snippet: msg.snippet ?? '', text: extractPlainText(msg.payload) };
    }),
  );
  return messages.filter((m): m is GmailCandidate => m !== null);
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

function extractPlainText(payload: GmailPart | undefined): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decodeBase64Url(payload.body.data);
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractPlainText(part);
      if (text) return text;
    }
  }
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  return '';
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return atob(base64);
  } catch {
    return '';
  }
}
