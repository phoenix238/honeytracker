import { useStore } from './ui/useStore';
import { useGoogleOAuthCallback } from './ui/useGoogleOAuthCallback';
import { Shell } from './ui/Shell';

export default function App() {
  const store = useStore();
  const googleAuthStatus = useGoogleOAuthCallback(store.setGoogleAuth);
  if (store.loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#82796a', fontSize: 13, fontFamily: "'Figtree', system-ui, sans-serif" }}>
        Loading…
      </div>
    );
  }
  return <Shell store={store} googleAuthStatus={googleAuthStatus} />;
}
