import { useState } from 'react';
import { useApp } from './ui/useApp';
import { Shell } from './ui/Shell';
import { T, fonts } from './ui/theme';
import { Button, inputStyle } from './ui/components';

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'center' }}>{children}</div>
    </div>
  );
}

export default function App() {
  const app = useApp();
  const [password, setPassword] = useState('');

  if (app.phase === 'loading') return <Centered><div style={{ color: T.textMuted, fontSize: 13 }}>Loading…</div></Centered>;

  if (app.phase === 'setup')
    return (
      <Centered>
        <div style={{ fontFamily: fonts.display, fontSize: 28, fontWeight: 800, color: T.accent }}>Honey</div>
        <div style={{ fontSize: 14, color: T.text, lineHeight: 1.6 }}>Almost set up: {app.setupMessage}</div>
        <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.6 }}>See SETUP.md in the repository for the full list.</div>
      </Centered>
    );

  if (app.phase === 'offline')
    return (
      <Centered>
        <div style={{ fontFamily: fonts.display, fontSize: 28, fontWeight: 800, color: T.accent }}>Honey</div>
        <div style={{ fontSize: 14, color: T.text }}>{app.error || 'Can’t reach the server.'}</div>
        <Button tone="primary" onClick={app.reload}>Try again</Button>
      </Centered>
    );

  if (app.phase === 'signin')
    return (
      <Centered>
        <div style={{ fontFamily: fonts.display, fontSize: 34, fontWeight: 800, color: T.accent }}>Honey</div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void app.signIn(password);
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <input style={inputStyle} type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          <Button tone="primary" type="submit" disabled={app.busy || !password}>Sign in</Button>
        </form>
        {app.error && <div style={{ fontSize: 13, color: T.danger }}>{app.error}</div>}
      </Centered>
    );

  return <Shell app={app} />;
}
