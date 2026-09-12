import { useState } from 'react';
import { Home } from './ui/Home';
import { sampleIncome, sampleExpenses } from './ui/sampleData';
import { DEFAULT_SETTINGS, type Settings } from './core/types';

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  return (
    <Home
      income={sampleIncome}
      expenses={sampleExpenses}
      settings={settings}
      onTaxPercentChange={(taxPercent) => setSettings((s) => ({ ...s, taxPercent }))}
    />
  );
}
