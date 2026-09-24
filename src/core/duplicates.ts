import { datesClose } from './dates.js';
import type { IsoDate, Pence } from './types.js';

// Flag records that look like accidental duplicates: same label, amounts within a penny,
// dates within six days. Ported from the Honeypot0101 rewrite that replaced an O(n^2)
// pairwise scan (131ms at 5000 rows) with a grouped one and proved them equivalent over 300
// randomised rounds. Group by label first — a duplicate must match there exactly — then walk
// each group in amount order and stop once the gap exceeds tolerance.

interface DupRecord {
  id: string;
  date: IsoDate;
}

export function findDuplicates<T extends DupRecord>(
  records: readonly T[],
  labelOf: (r: T) => string | undefined,
  amountOf: (r: T) => Pence,
  tolerancePence: Pence = 1,
): Set<string> {
  const flagged = new Set<string>();
  const groups = new Map<string, T[]>();
  for (const r of records) {
    const key = (labelOf(r) ?? '').toLowerCase().trim();
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => amountOf(a) - amountOf(b));
    for (let i = 0; i < group.length; i++) {
      const a = group[i]!;
      for (let j = i + 1; j < group.length; j++) {
        const b = group[j]!;
        if (amountOf(b) - amountOf(a) > tolerancePence) break;
        if (datesClose(a.date, b.date)) {
          flagged.add(a.id);
          flagged.add(b.id);
        }
      }
    }
  }
  return flagged;
}
