// Stateless OAuth token exchange/refresh. Never stores anything — the client holds its own
// tokens in IndexedDB. This endpoint's only job is to be the one place that knows
// GOOGLE_CLIENT_SECRET, which must never reach the browser.

export const config = { runtime: 'edge' };

interface ExchangeBody {
  code?: string;
  redirectUri?: string;
  refreshToken?: string;
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return Response.json({ error: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured on this deployment.' }, { status: 500 });
  }

  let body: ExchangeBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret });
  if (body.refreshToken) {
    params.set('grant_type', 'refresh_token');
    params.set('refresh_token', body.refreshToken);
  } else if (body.code && body.redirectUri) {
    params.set('grant_type', 'authorization_code');
    params.set('code', body.code);
    params.set('redirect_uri', body.redirectUri);
  } else {
    return Response.json({ error: "Provide either 'refreshToken' or both 'code' and 'redirectUri'." }, { status: 400 });
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    return Response.json({ error: data.error_description || data.error || 'Google token exchange failed.' }, { status: 502 });
  }

  return Response.json({
    accessToken: data.access_token,
    // Google omits refresh_token on a refresh request — the caller keeps its existing one.
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  });
}
