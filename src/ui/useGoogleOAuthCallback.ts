import { useEffect, useState } from 'react';
import { buildAuthUrl, fetchUserEmail, type GoogleAuth } from '../integrations/google';

const STATE_KEY = 'honeytracker-google-oauth-state';

/** The exact URL Google must redirect back to — must match an "Authorized redirect URI" on the OAuth client. */
export function googleRedirectUri(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

export function beginGoogleAuth(clientId: string): void {
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);
  window.location.href = buildAuthUrl(clientId, googleRedirectUri(), state);
}

/**
 * Runs once on load: if the URL carries an OAuth redirect (`?code=...&state=...`), completes
 * the exchange and cleans the URL. Returns a status so a settings screen can show progress
 * without every screen needing to know this is happening.
 */
export function useGoogleOAuthCallback(setGoogleAuth: (auth: GoogleAuth) => Promise<void>): 'idle' | 'connecting' | 'error' {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'error'>('idle');

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) return;

    const expected = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
    url.searchParams.delete('code');
    url.searchParams.delete('state');
    url.searchParams.delete('scope');
    window.history.replaceState({}, '', url.toString());

    if (state !== expected) {
      setStatus('error');
      return;
    }

    setStatus('connecting');
    (async () => {
      try {
        const res = await fetch('/api/auth/google/token', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code, redirectUri: googleRedirectUri() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Google sign-in failed.');
        const email = await fetchUserEmail(data.accessToken);
        await setGoogleAuth({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          expiresAt: Date.now() + data.expiresIn * 1000,
          email,
        });
        setStatus('idle');
      } catch {
        setStatus('error');
      }
    })();
    // Runs once per app load, deliberately not re-running when setGoogleAuth's identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return status;
}
