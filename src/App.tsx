import { useStore } from './ui/useStore';
import { Shell } from './ui/Shell';

export default function App() {
  const store = useStore();
  if (store.loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#82796a', fontSize: 13, fontFamily: "'Figtree', system-ui, sans-serif" }}>
        Loading…
      </div>
    );
  }
  return <Shell store={store} />;
}
