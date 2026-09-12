import { useStore } from './ui/useStore';
import { Home } from './ui/Home';
import { T } from './ui/theme';

export default function App() {
  const store = useStore();
  if (store.loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: T.textMuted, fontSize: 13 }}>
        Loading…
      </div>
    );
  }
  return <Home store={store} />;
}
