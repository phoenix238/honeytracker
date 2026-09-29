import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ExpenseCategory, Receipt, Transaction } from '../core/types';
import { receiptsFor } from '../core/receiptMatch';
import { QUICK_CATEGORIES, categoryInfo } from '../core/hmrc';
import { findSimilar, needsDecision, orderQueue, predict, rulePattern, type Decision } from '../core/sortQueue';
import { mkId } from '../core/id';
import { T, fonts } from './theme';
import { BUCKET_COLOR, BUCKET_LABEL, Button, Money, fmtDate } from './components';
import { TransactionSheet } from './TransactionSheet';
import { useSwipe } from './swipe';
import type { App } from './useApp';

// Sorting, one card at a time: swipe right for business, left for not, or use the buttons.
// With Smart match on, one swipe also sorts every waiting row from the same payee, and new ones
// sort themselves from then on. Every swipe can be undone. It aims for 25 a day, then says stop.

const DAILY_GOAL = 25;
const TOAST_MS = 6000;
const FLY_MS = 260;

type Step = 'card' | 'category' | 'stream';
interface Done {
  batchId: string;
  count: number;
  text: string;
}

function readStore<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode — progress just isn't remembered */
  }
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function SortDeck({ app, onClose }: { app: App; onClose: () => void }) {
  const data = app.data!;
  const streams = data.streams.filter((s) => !s.archived);
  const hasStreams = streams.length > 0;
  const [smart, setSmart] = useState(() => readStore('ht:smart', true));
  const [skipped, setSkipped] = useState<string[]>([]);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [pick, setPick] = useState<{ id: string; streamId?: string | null; category?: ExpenseCategory | null }>({ id: '' });
  const [step, setStep] = useState<Step>('card');
  const [showSimilar, setShowSimilar] = useState(false);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Done[]>([]);
  const [toast, setToast] = useState<Done | null>(null);
  const [error, setError] = useState('');
  const [moreId, setMoreId] = useState<string | null>(null);
  /** The card on its way off the screen, and which way. */
  const [leaving, setLeaving] = useState<'left' | 'right' | null>(null);
  /** Attach the receipt Honey found for this card (on by default; untick if it's the wrong one). */
  const [attach, setAttach] = useState(true);
  const [day, setDay] = useState(() => {
    const saved = readStore<{ date: string; done: number }>('ht:sortDay', { date: '', done: 0 });
    return saved.date === data.today ? saved : { date: data.today, done: 0 };
  });
  const [goalSeen, setGoalSeen] = useState(day.done >= DAILY_GOAL);
  const [live, setLive] = useState('');
  const chain = useRef<Promise<void>>(Promise.resolve());
  const lastStream = readStore<string | null>('ht:lastStreamId', null);

  const waiting = useMemo(
    () => data.transactions.filter((t) => needsDecision(t, hasStreams) && !pending.has(t.id)),
    [data.transactions, hasStreams, pending],
  );
  const queue = useMemo(() => {
    const ordered = orderQueue(waiting);
    const inQueue = new Set(ordered.map((t) => t.id));
    const later = skipped.filter((id) => inQueue.has(id));
    const laterSet = new Set(later);
    const byId = new Map(ordered.map((t) => [t.id, t]));
    return [...ordered.filter((t) => !laterSet.has(t.id)), ...later.map((id) => byId.get(id)!)];
  }, [waiting, skipped]);
  const card = queue[0] ?? null;

  // A fresh card starts from its own best guesses.
  useEffect(() => {
    setStep('card');
    setShowSimilar(false);
    setUnticked(new Set());
    setAttach(true);
  }, [card?.id]);

  const guess = card
    ? predict(card, { streams: data.streams, settings: data.settings, receipts: data.receipts, history: data.transactions, lastStreamId: lastStream })
    : null;
  const mine = pick.id === card?.id ? pick : { id: card?.id ?? '' };
  const streamId = mine.streamId !== undefined ? mine.streamId : guess?.right.streamId ?? null;
  const category = mine.category !== undefined ? mine.category : guess?.right.category ?? null;
  // Similar rows in the same state as this card, so a swipe never un-sorts something already decided.
  const similar = card && smart ? findSimilar(card, waiting).filter((x) => x.bucket === card.bucket) : [];
  const alsoSorting = similar.filter((x) => !unticked.has(x.id));
  const pattern = card && smart ? rulePattern(card) : null;
  // The same rule already standing — no need to make it again. (A different one is replaced.)
  const ruleStands = (d: Pick<Decision, 'bucket' | 'streamId' | 'category'>) =>
    pattern &&
    data.rules.some(
      (r) => r.field === pattern.field && r.pattern.toLowerCase() === pattern.pattern && r.direction === card!.direction &&
        r.bucket === d.bucket && r.streamId === d.streamId && r.category === d.category,
    );

  const bumpDay = (n: number) =>
    setDay((d) => {
      const next = { date: data.today, done: Math.max(0, (d.date === data.today ? d.done : 0) + n) };
      writeStore('ht:sortDay', next);
      return next;
    });

  /**
   * Which receipt goes with which row on a business cost: the one shown on the card (if left
   * ticked), and for each similar row the one receipt that fits it — never the same one twice,
   * and nothing when a row has more than one that could be it.
   */
  const receiptsForRows = (rows: Transaction[], shown: Receipt | null): Map<string, string> => {
    const out = new Map<string, string>();
    const used = new Set<string>();
    if (shown && attach) {
      out.set(rows[0]!.id, shown.id);
      used.add(shown.id);
    }
    for (const r of rows.slice(1)) {
      if (r.receiptIds.length) continue;
      const fits = receiptsFor(r, data.receipts).filter((x) => !used.has(x.id));
      if (fits.length !== 1) continue;
      out.set(r.id, fits[0]!.id);
      used.add(fits[0]!.id);
    }
    return out;
  };

  const commit = (t: Transaction, decision: Decision, others: Transaction[], shownReceipt: Receipt | null) => {
    const batchId = mkId();
    const rows = [t, ...others];
    const receiptOf = decision.bucket === 'business_expense' ? receiptsForRows(rows, shownReceipt) : new Map<string, string>();
    const patch = {
      bucket: decision.bucket,
      streamId: decision.bucket === 'business_income' || decision.bucket === 'business_expense' ? decision.streamId : null,
      category: decision.bucket === 'business_expense' ? decision.category ?? 'otherExpenses' : null,
      businessPercent: decision.bucket === 'business_expense' && t.bucket === 'business_expense' ? t.businessPercent : 100,
    };
    const rule =
      smart && pattern && !ruleStands({ bucket: decision.bucket, streamId: patch.streamId, category: patch.category })
        ? { ...pattern, direction: t.direction, bucket: decision.bucket, streamId: patch.streamId, category: patch.category, businessPercent: 100 }
        : null;
    const label =
      decision.bucket === 'business_expense'
        ? `Business cost · ${categoryInfo(patch.category!).label}`
        : BUCKET_LABEL[decision.bucket];
    const ids = rows.map((r) => r.id);
    setPending((p) => new Set([...p, ...ids]));
    setSkipped((s) => s.filter((id) => !ids.includes(id)));
    setError('');
    if (patch.streamId) writeStore('ht:lastStreamId', patch.streamId);

    chain.current = chain.current.then(async () => {
      try {
        const res = await app.saveBatch({
          batchId,
          items: rows.map((r) => ({
            id: r.id,
            patch,
            expectUpdatedAt: r.updatedAt,
            unlessYours: r.id !== t.id,
            ...(receiptOf.has(r.id) ? { attachReceiptIds: [receiptOf.get(r.id)!] } : {}),
          })),
          rule,
        });
        const n = res.updated.length;
        const text =
          `${n === 1 ? (t.counterparty || t.reference || 'Row') : `${n} rows`} → ${label}` +
          (res.receiptsAttached ? ` · ${res.receiptsAttached} receipt${res.receiptsAttached === 1 ? '' : 's'} attached` : '') +
          (res.rule ? ` · new “${res.rule.pattern}” ones will sort themselves` : '') +
          (res.skipped.length ? ` · ${res.skipped.length} left as they were (changed meanwhile)` : '');
        const entry = { batchId, count: n, text };
        setDone((d) => [...d, entry]);
        setToast(entry);
        setLive(text);
        bumpDay(n);
      } catch (e) {
        setError(`Not saved — ${(e as Error).message} It’s back on the pile.`);
      } finally {
        setPending((p) => {
          const next = new Set(p);
          for (const id of ids) next.delete(id);
          return next;
        });
      }
    });
  };

  const goalHit = day.done >= DAILY_GOAL && !goalSeen && queue.length > 0;

  /** Send the card off the screen, then save — so every decision has the same feel, swipe or tap. */
  const fly = (dir: 'left' | 'right', run: () => void) => {
    if (reducedMotion()) return run();
    setLeaving(dir);
    window.setTimeout(() => {
      setLeaving(null);
      run();
    }, FLY_MS);
  };

  const decide = (dir: 'left' | 'right') => {
    if (!card || !guess || leaving) return;
    const t = card;
    const others = alsoSorting;
    const shown = guess.receipt;
    if (dir === 'left') return fly('left', () => commit(t, guess.left, others, null));
    const decision: Decision = { ...guess.right, streamId, category };
    if (card.direction === 'out' && !decision.category) return setStep('category');
    if (streams.length > 1 && !decision.streamId) return setStep('stream');
    fly('right', () => commit(t, decision, others, shown));
  };

  const skip = () => {
    if (!card) return;
    setSkipped((s) => [...s.filter((id) => id !== card.id), card.id]);
  };

  const undo = async (entry = done[done.length - 1]) => {
    if (!entry) return;
    await chain.current; // let anything still saving land first
    const res = await app.undoBatch(entry.batchId);
    if (!res) return;
    setDone((d) => d.filter((x) => x.batchId !== entry.batchId));
    setToast(null);
    bumpDay(-res.undone);
    setLive(`Undone: ${entry.text}`);
  };

  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(h);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (moreId || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (goalHit && e.key !== 'Escape') return; // the "that's enough for today" screen is showing
      if (leaving) return;
      if (e.key === 'ArrowRight') decide('right');
      else if (e.key === 'ArrowLeft') decide('left');
      else if (e.key === 'ArrowDown') skip();
      else if (e.key.toLowerCase() === 'z') void undo();
      else if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const finish = async () => {
    await chain.current;
    const left = queue.length;
    app.notify(day.done ? `${day.done} sorted today${left ? ` · ${left} left for next time` : ' · all sorted'}.` : left ? `${left} still to sort — no rush.` : 'All sorted.');
    onClose();
  };

  const swipe = useSwipe(decide, Boolean(card) && step === 'card' && !moreId && !leaving);
  const width = typeof window === 'undefined' ? 390 : Math.min(window.innerWidth, 520);
  // How far towards a decision the drag is, 0–1: drives the tint, the stamp and the card behind.
  const pull = leaving ? 1 : Math.min(1, Math.abs(swipe.dx) / (width * 0.35));
  const lean = leaving ?? (swipe.dx > 24 ? 'right' : swipe.dx < -24 ? 'left' : null);
  const cardTransform = leaving
    ? `translateX(${(leaving === 'right' ? 1 : -1) * (width + 160)}px) rotate(${leaving === 'right' ? 18 : -18}deg)`
    : `translateX(${swipe.dx}px) rotate(${reducedMotion() ? 0 : swipe.dx / 20}deg)`;
  const next = queue[1] ?? null;
  const rightLabel = guess
    ? guess.right.bucket === 'business_income'
      ? `Business income${streamId ? ` · ${streams.find((s) => s.id === streamId)?.name ?? ''}` : ''}`
      : `Business cost${category ? ` · ${QUICK_CATEGORIES.find((c) => c.key === category)?.label ?? categoryInfo(category).label}` : ''}`
    : '';
  const leftLabel = 'Personal';

  return (
    <div
      role="dialog"
      aria-label="Sort transactions"
      style={{ position: 'fixed', inset: 0, zIndex: 180, background: T.bg, overflowY: 'auto', overscrollBehavior: 'contain' }}
    >
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 14, minHeight: '100%' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" onClick={finish} style={linkBtn}>✕ Finish later</button>
          <div style={{ flex: 1, textAlign: 'center', fontSize: 12, color: T.textMuted, fontFamily: fonts.mono }}>
            {day.done} today · {queue.length} left
          </div>
          <button
            type="button"
            aria-pressed={smart}
            onClick={() => {
              setSmart(!smart);
              writeStore('ht:smart', !smart);
            }}
            style={{ ...linkBtn, color: smart ? T.green : T.textMuted, border: `1px solid ${smart ? T.green : T.border}`, borderRadius: 999, padding: '5px 10px' }}
          >
            Smart match {smart ? 'on' : 'off'}
          </button>
        </header>
        <div aria-hidden style={{ height: 4, background: T.surface, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(100, (day.done / DAILY_GOAL) * 100)}%`, background: T.accent, transition: 'width 0.3s' }} />
        </div>

        {(error || app.error) && (
          <div role="alert" style={{ background: '#2a1512', border: `1px solid ${T.danger}`, borderRadius: 12, padding: '10px 12px', fontSize: 13, lineHeight: 1.5 }}>
            {error || `Not done. ${app.error}`}
          </div>
        )}

        {!card ? (
          <div style={{ textAlign: 'center', padding: '60px 12px', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
            <div style={{ fontSize: 44 }}>🍯</div>
            <div style={{ fontFamily: fonts.display, fontSize: 24, fontWeight: 800 }}>{pending.size ? 'Saving the last few…' : 'All sorted'}</div>
            <div style={{ fontSize: 14, color: T.textMuted, lineHeight: 1.6 }}>Every transaction has a home. New ones from the bank will land here.</div>
            <Button tone="primary" onClick={finish}>Done</Button>
          </div>
        ) : goalHit ? (
          <div style={{ textAlign: 'center', padding: '48px 12px', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
            <div style={{ fontSize: 44 }}>✅</div>
            <div style={{ fontFamily: fonts.display, fontSize: 24, fontWeight: 800 }}>That’s {DAILY_GOAL} today</div>
            <div style={{ fontSize: 14, color: T.textMuted, lineHeight: 1.6 }}>
              A good place to stop. The other {queue.length} will wait — a few minutes a day clears the pile without it taking over.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button tone="primary" onClick={finish}>Stop for today</Button>
              <Button onClick={() => setGoalSeen(true)}>Keep going</Button>
            </div>
          </div>
        ) : (
          <>
            {/* The deck: the next card waits behind, growing into place as this one is pulled away. */}
            <div style={{ position: 'relative' }}>
              {next && (
                <div
                  aria-hidden
                  style={{
                    position: 'absolute', inset: 0, background: T.surface, border: `2px solid ${T.border}`, borderRadius: 18, padding: 16,
                    transform: `translateY(${12 - 12 * pull}px) scale(${0.94 + 0.06 * pull})`, opacity: 0.45 + 0.55 * pull,
                    transition: swipe.dragging ? 'none' : `transform ${FLY_MS}ms ease-out, opacity ${FLY_MS}ms ease-out`,
                    overflow: 'hidden', pointerEvents: 'none',
                  }}
                >
                  <div style={{ fontFamily: fonts.display, fontSize: 20, fontWeight: 800, marginTop: 22 }}>{next.counterparty || next.reference || '—'}</div>
                  <div style={{ marginTop: 8 }}><Money pence={next.amountPence} signed={next.direction} color={next.direction === 'in' ? T.green : T.text} size={28} /></div>
                </div>
              )}
            <div
              key={card.id}
              {...swipe.handlers}
              style={{
                touchAction: 'pan-y',
                userSelect: 'none',
                transform: cardTransform,
                opacity: leaving ? 0 : 1,
                // Following the finger exactly; flying off quickly; springing back with a little bounce.
                transition: swipe.dragging || reducedMotion()
                  ? 'none'
                  : leaving
                    ? `transform ${FLY_MS}ms cubic-bezier(.5,0,.9,.4), opacity ${FLY_MS}ms ease-in`
                    : 'transform 0.38s cubic-bezier(.2,.9,.3,1.25)',
                background: T.surface,
                border: `2px solid ${lean === 'right' ? T.green : lean === 'left' ? T.textMuted : T.border}`,
                borderRadius: 18,
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                position: 'relative',
                zIndex: 1,
                boxShadow: swipe.dragging ? '0 18px 40px rgba(0,0,0,0.45)' : '0 6px 18px rgba(0,0,0,0.25)',
                willChange: 'transform',
              }}
            >
              {/* A wash of colour that deepens as the swipe gets closer to counting. */}
              <div
                aria-hidden
                style={{
                  position: 'absolute', inset: 0, borderRadius: 16, pointerEvents: 'none',
                  background: lean === 'right' ? `linear-gradient(90deg, transparent, ${T.green}55)` : lean === 'left' ? `linear-gradient(270deg, transparent, ${T.textMuted}55)` : 'transparent',
                  opacity: pull,
                }}
              />
              {lean && (
                <div
                  aria-hidden
                  style={{
                    position: 'absolute', top: 14, [lean === 'right' ? 'left' : 'right']: 14,
                    border: `2px solid ${lean === 'right' ? T.green : T.textMuted}`, color: lean === 'right' ? T.green : T.textMuted,
                    borderRadius: 8, padding: '3px 8px', fontWeight: 800, fontSize: 13,
                    transform: `rotate(${lean === 'right' ? -8 : 8}deg) scale(${0.8 + 0.3 * pull})`, opacity: Math.max(0.35, pull),
                  }}
                >
                  {lean === 'right' ? 'BUSINESS' : leftLabel.toUpperCase()}
                </div>
              )}
              <div style={{ fontSize: 12, color: T.textMuted, textAlign: 'right' }}>
                {fmtDate(card.date)}
                {card.meta.account ? ` · ${card.meta.account}` : card.source === 'cash' ? ' · cash' : card.source === 'import' ? ' · old app' : ''}
              </div>
              <div>
                <div style={{ fontFamily: fonts.display, fontSize: 20, fontWeight: 800, lineHeight: 1.2, wordBreak: 'break-word' }}>
                  {card.counterparty || card.reference || 'No name from the bank'}
                </div>
                {card.reference && card.counterparty && <div style={{ fontSize: 13, color: T.textMuted, marginTop: 4 }}>Ref: {card.reference}</div>}
              </div>
              <Money pence={card.amountPence} signed={card.direction} color={card.direction === 'in' ? T.green : T.text} size={28} />

              {card.receiptIds.length > 0 && <Hint>🧾 Receipt attached</Hint>}
              {guess?.receipt && (
                <label onPointerDown={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: T.green, lineHeight: 1.5 }}>
                  <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} style={{ marginTop: 2 }} />
                  <span>
                    🧾 Found its receipt: {guess.receipt.merchant || guess.receipt.filename}
                    {guess.receipt.date ? ` · ${fmtDate(guess.receipt.date)}` : ''} · {/^(message|email)|\.eml$|text\/plain/i.test(`${guess.receipt.filename} ${guess.receipt.mime}`) ? 'from your email' : 'you snapped it'}.{' '}
                    Attaches when you swipe it as business.
                  </span>
                </label>
              )}
              {card.note && <Hint>✏️ {card.note}</Hint>}
              {card.classifiedBy === 'ai' && (
                <Hint color={T.accentBright}>
                  🤖 AI thinks: {BUCKET_LABEL[card.bucket]}
                  {card.category ? ` · ${categoryInfo(card.category).label}` : ''} ({card.meta.aiConfidence || 'low'}){card.meta.aiReason ? ` — ${card.meta.aiReason}` : ''}
                </Hint>
              )}
              {card.bucket !== 'unreviewed' && card.classifiedBy !== 'ai' && !card.streamId && (
                <Hint>Counted as {BUCKET_LABEL[card.bucket].toLowerCase()} — just needs a stream.</Hint>
              )}
              {guess?.looksLikeWages && (
                <Hint color={T.danger}>
                  Says wages. If this is from a payroll job (you get payslips), it isn’t self-employed income: swipe left, and put the P60 or payslip figures in Tax → “What the bank can’t tell me”, or it’s taxed twice.
                </Hint>
              )}

              {step === 'card' && card.direction === 'in' && streams.length > 1 && (
                <Chips label="If business, which work?">
                  {streams.map((s) => (
                    <Pill key={s.id} active={streamId === s.id} color={s.color} onClick={() => setPick({ ...mine, id: card.id, streamId: s.id })}>{s.name}</Pill>
                  ))}
                </Chips>
              )}
              {step === 'card' && card.direction === 'out' && (
                <Chips label="If business, what for?">
                  {QUICK_CATEGORIES.map((c) => (
                    <Pill key={c.key} active={category === c.key} color={T.expense} onClick={() => setPick({ ...mine, id: card.id, category: c.key })}>
                      {c.icon} {c.label}
                    </Pill>
                  ))}
                  {category && !QUICK_CATEGORIES.some((c) => c.key === category) && (
                    <Pill active color={T.expense} onClick={() => undefined}>{categoryInfo(category).label}</Pill>
                  )}
                </Chips>
              )}
              {step === 'card' && card.direction === 'out' && streams.length > 1 && (
                <Chips label="Which work?">
                  {streams.map((s) => (
                    <Pill key={s.id} active={streamId === s.id} color={s.color} onClick={() => setPick({ ...mine, id: card.id, streamId: s.id })}>{s.name}</Pill>
                  ))}
                </Chips>
              )}

              {step === 'category' && (
                <Chips label="Which kind of cost? Tap one to save.">
                  {QUICK_CATEGORIES.map((c) => (
                    <Pill key={c.key} active={false} color={T.expense} onClick={() => {
                      setPick({ ...mine, id: card.id, category: c.key });
                      const decision = { ...guess!.right, streamId, category: c.key };
                      const t = card;
                      const others = alsoSorting;
                      const shown = guess!.receipt;
                      if (streams.length > 1 && !decision.streamId) setStep('stream');
                      else fly('right', () => commit(t, decision, others, shown));
                    }}>
                      {c.icon} {c.label}
                    </Pill>
                  ))}
                  <Pill active={false} onClick={() => setStep('card')}>Cancel</Pill>
                </Chips>
              )}
              {step === 'stream' && (
                <Chips label="Which work is it for? Tap one to save.">
                  {streams.map((s) => (
                    <Pill key={s.id} active={false} color={s.color} onClick={() => {
                      setPick({ ...mine, id: card.id, streamId: s.id });
                      const t = card;
                      const others = alsoSorting;
                      const shown = guess!.receipt;
                      fly('right', () => commit(t, { ...guess!.right, streamId: s.id, category }, others, shown));
                    }}>
                      {s.name}
                    </Pill>
                  ))}
                  <Pill active={false} onClick={() => setStep('card')}>Cancel</Pill>
                </Chips>
              )}

              {smart && (similar.length > 0 || pattern) && step === 'card' && (
                <div style={{ fontSize: 12, color: T.green, lineHeight: 1.5 }}>
                  {similar.length > 0 && (
                    <button type="button" onClick={() => setShowSimilar(!showSimilar)} style={{ ...linkBtn, color: T.green, padding: 0, textDecoration: 'underline' }}>
                      Also sorts {alsoSorting.length} similar {showSimilar ? '▴' : '▾'}
                    </button>
                  )}
                  {pattern && <span>{similar.length > 0 ? ' · ' : ''}new “{pattern.pattern}” ones will follow</span>}
                </div>
              )}
              {showSimilar && step === 'card' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
                  {similar.map((x) => (
                    <label key={x.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={!unticked.has(x.id)}
                        onChange={(e) => {
                          const next = new Set(unticked);
                          if (e.target.checked) next.delete(x.id);
                          else next.add(x.id);
                          setUnticked(next);
                        }}
                      />
                      <span style={{ flex: 1 }}>{fmtDate(x.date)} · {x.reference || x.counterparty}</span>
                      <Money pence={x.amountPence} size={12} />
                    </label>
                  ))}
                </div>
              )}
            </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button type="button" onClick={() => setMoreId(card.id)} style={linkBtn}>More options…</button>
              {done.length > 0 && (
                <button type="button" onClick={() => void undo()} disabled={app.busy} style={linkBtn}>↶ Undo last</button>
              )}
            </div>
            {/* The buttons stay in reach however tall the card is. */}
            <div style={{ position: 'sticky', bottom: 0, background: T.bg, padding: '8px 0 calc(8px + env(safe-area-inset-bottom, 0px))', display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, marginTop: 'auto' }}>
              <Button onClick={() => decide('left')} style={{ flexDirection: 'column', gap: 2, borderColor: BUCKET_COLOR[guess?.left.bucket ?? 'personal'] }}>
                <span>← Not business</span>
                <span style={{ fontSize: 11, fontWeight: 500, color: T.textMuted }}>{leftLabel}</span>
              </Button>
              <Button tone="quiet" onClick={skip}>Skip</Button>
              <Button tone="green" onClick={() => decide('right')} style={{ flexDirection: 'column', gap: 2 }}>
                <span>Business →</span>
                <span style={{ fontSize: 11, fontWeight: 500 }}>{rightLabel}</span>
              </Button>
            </div>
          </>
        )}
      </div>

      {toast && (
        <div
          style={{
            // Above the swipe buttons, never over them.
            position: 'fixed', left: 16, right: 16, bottom: 'calc(88px + env(safe-area-inset-bottom, 0px))', maxWidth: 488, margin: '0 auto',
            background: T.surface, border: `1px solid ${T.green}`, borderRadius: 12, padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'center', zIndex: 190,
          }}
        >
          <span style={{ flex: 1, fontSize: 13, lineHeight: 1.4 }}>{toast.text}</span>
          <button type="button" onClick={() => void undo(toast)} style={{ ...linkBtn, color: T.accentBright, fontWeight: 700 }}>Undo</button>
        </div>
      )}
      <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{live}</div>

      <TransactionSheet app={app} txn={data.transactions.find((t) => t.id === moreId) ?? null} onClose={() => setMoreId(null)} />
    </div>
  );
}

const linkBtn = { background: 'none', border: 'none', color: T.textMuted, fontSize: 13, cursor: 'pointer', fontFamily: fonts.body, padding: '4px 0' } as const;

function Hint({ children, color = T.textMuted }: { children: ReactNode; color?: string }) {
  return <div style={{ fontSize: 12, color, lineHeight: 1.5 }}>{children}</div>;
}

function Chips({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>{label}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{children}</div>
    </div>
  );
}

function Pill({ active, color = T.accent, onClick, children }: { active: boolean; color?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Taps on chips must not start a swipe.
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        background: active ? color + '26' : 'transparent',
        border: `1px solid ${active ? color : T.border}`,
        color: active ? color : T.text,
        borderRadius: 999,
        padding: '5px 10px',
        fontSize: 12.5,
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: fonts.body,
      }}
    >
      {children}
    </button>
  );
}
