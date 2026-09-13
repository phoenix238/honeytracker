import { useRef, useState } from 'react';
import { formatGBP, formatAmount, parsePence, percentOf } from '../../core/money';
import { mkId } from '../../core/id';
import { today } from '../../core/dates';
import type { Expense } from '../../core/types';
import type { ExtractedExpense } from '../../core/extraction';
import { repository } from '../../storage/repository';
import { searchReceiptEmails, type GmailCandidate } from '../../integrations/google';
import { pageBackground, type Theme } from '../theme';
import { Glass } from '../components/Glass';
import { TextFieldPill } from '../components/FieldRow';
import { PillButton } from '../components/PillButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { CameraIcon, CheckIcon, PiggyBankIcon } from '../icons';
import type { Store } from '../useStore';

interface Candidate extends GmailCandidate {
  extracted: ExtractedExpense;
}

async function extractFromCandidate(c: GmailCandidate): Promise<Candidate | null> {
  try {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: c.text || c.snippet }),
    });
    const data = await res.json();
    if (!res.ok || !data.isExpense || !data.amountPence) return null;
    return { ...c, extracted: data as ExtractedExpense };
  } catch {
    return null;
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

type ScanState = 'idle' | 'scanning' | 'done' | 'error';
type GmailState = 'idle' | 'loading' | 'empty' | 'done' | 'error';

export function ReceiptView({ store, T, onDone }: { store: Store; T: Theme; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [category, setCategory] = useState('');
  const [scan, setScan] = useState<ScanState>('idle');
  const [scanMessage, setScanMessage] = useState('');

  const [mode, setMode] = useState<'manual' | 'gmail'>('manual');
  const [gmailState, setGmailState] = useState<GmailState>('idle');
  const [gmailError, setGmailError] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const amountPence = parsePence(amount);
  const saving = percentOf(amountPence, store.settings.taxPercent);

  const pickPhoto = async (file: File) => {
    setPhoto(file);
    setPreviewUrl(URL.createObjectURL(file));
    setScan('scanning');
    setScanMessage('');
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await fetch('/api/receipts/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scan failed.');
      if (!data.isExpense) {
        setScan('error');
        setScanMessage("Couldn't find a receipt in that photo — fill in the details below.");
        return;
      }
      setMerchant(data.merchant || '');
      setAmount(data.amountPence ? formatAmount(data.amountPence) : '');
      if (data.date) setDate(data.date);
      setCategory(data.category || '');
      setScan('done');
    } catch (e) {
      setScan('error');
      setScanMessage(e instanceof Error ? e.message : 'Could not read this photo — fill in the details below.');
    }
  };

  const submit = async () => {
    if (amountPence <= 0) return;
    const id = mkId();
    let imageId: string | undefined;
    if (photo) {
      imageId = id + '-img';
      await repository.saveImage(imageId, photo);
    }
    const record: Expense = {
      id,
      date,
      amountPence,
      category: category.trim() || 'other',
      deductible: true,
      note: merchant.trim() || undefined,
      imageId,
      createdAt: new Date().toISOString(),
    };
    store.addExpense(record);
    onDone();
  };

  const startGmailImport = async () => {
    setMode('gmail');
    setGmailState('loading');
    setGmailError('');
    try {
      const token = await store.freshGoogleAccessToken();
      const emails = await searchReceiptEmails(token);
      const results = await Promise.all(emails.map(extractFromCandidate));
      const found = results.filter((c): c is Candidate => c !== null);
      setCandidates(found);
      setSelected(new Set(found.map((c) => c.id)));
      setGmailState(found.length ? 'done' : 'empty');
    } catch (e) {
      setGmailState('error');
      setGmailError(e instanceof Error ? e.message : 'Could not import from Gmail.');
    }
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const importSelected = () => {
    candidates
      .filter((c) => selected.has(c.id))
      .forEach((c) => {
        store.addExpense({
          id: mkId(),
          date: c.extracted.date || today(),
          amountPence: c.extracted.amountPence,
          category: c.extracted.category || 'other',
          deductible: true,
          note: c.extracted.merchant || undefined,
          createdAt: new Date().toISOString(),
        });
      });
    onDone();
  };

  if (mode === 'gmail') {
    return (
      <div style={{ background: pageBackground(T, 'accent'), borderRadius: 32, padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ScreenHeader T={T} title="Import from Gmail" onBack={() => setMode('manual')} />

        {gmailState === 'loading' && (
          <div style={{ fontSize: 13, color: T.textMuted, textAlign: 'center', padding: '32px 12px' }}>Searching your inbox for receipts…</div>
        )}
        {gmailState === 'error' && (
          <div style={{ fontSize: 13, color: T.danger, textAlign: 'center', padding: '32px 12px' }}>{gmailError}</div>
        )}
        {gmailState === 'empty' && (
          <div style={{ fontSize: 13, color: T.textFaint, textAlign: 'center', padding: '32px 12px' }}>No receipt-looking emails from the last 90 days.</div>
        )}
        {gmailState === 'done' && (
          <>
            <div style={{ fontSize: 12, color: T.textMuted, padding: '0 4px' }}>Found {candidates.length} — uncheck any that aren't real costs.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {candidates.map((c) => (
                <Glass key={c.id} T={T} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px' }}>
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelected(c.id)} style={{ width: 18, height: 18, flexShrink: 0, accentColor: T.accent }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{c.extracted.merchant || 'Unknown merchant'}</div>
                    <div style={{ fontSize: 11, color: T.textMuted }}>{c.extracted.date} · {c.extracted.category}</div>
                  </div>
                  <span style={{ fontFamily: 'inherit', fontSize: 15, fontWeight: 700, color: T.text, flexShrink: 0 }}>{formatGBP(c.extracted.amountPence)}</span>
                </Glass>
              ))}
            </div>
            <PillButton T={T} onClick={importSelected} disabled={selected.size === 0}>
              Import {selected.size || ''} {selected.size === 1 ? 'expense' : 'expenses'}
            </PillButton>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ background: pageBackground(T, 'accent'), borderRadius: 32, padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ScreenHeader T={T} title="Receipt" onBack={onDone} />

      <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0' }}>
        <button
          onClick={() => fileRef.current?.click()}
          style={{
            position: 'relative',
            width: 180,
            height: 220,
            borderRadius: 28,
            overflow: 'hidden',
            background: previewUrl ? `center/cover no-repeat url(${previewUrl})` : `linear-gradient(160deg, ${T.ramp.neutral[T.mode === 'dark' ? 700 : 200]}, ${T.ramp.neutral[T.mode === 'dark' ? 800 : 300]})`,
            border: `1px solid ${T.glassBorder}`,
            boxShadow: T.shadowMd,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            cursor: 'pointer',
          }}
        >
          {!previewUrl && (
            <>
              <CameraIcon size={34} color={T.ramp.neutral[600]} />
              <span style={{ fontSize: 11, fontWeight: 700, color: T.ramp.neutral[600] }}>Add a photo</span>
            </>
          )}
          <span
            style={{
              position: 'absolute',
              bottom: 12,
              right: 12,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 999,
              background: previewUrl ? T.ramp.accent2[500] : T.mode === 'dark' ? T.surface : T.ramp.neutral[300],
              color: previewUrl ? '#fff' : T.ramp.neutral[600],
            }}
          >
            {previewUrl ? <CheckIcon size={16} color="#fff" /> : <CameraIcon size={14} />}
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pickPhoto(f);
            e.target.value = '';
          }}
        />
      </div>

      <div style={{ textAlign: 'center', fontSize: 12, color: scan === 'error' ? T.danger : scan === 'done' ? (T.mode === 'dark' ? T.ramp.accent2[300] : T.ramp.accent2[800]) : T.textMuted }}>
        {scan === 'scanning' && 'Reading the receipt…'}
        {scan === 'done' && 'Read from the photo — check it over below'}
        {scan === 'error' && scanMessage}
        {scan === 'idle' && "Snap a photo and it'll read itself, or fill in the details below"}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button
          onClick={() => (store.googleAuth ? void startGmailImport() : setGmailError('Connect Gmail first, in More → Integrations.'))}
          style={{ background: 'none', border: 'none', color: T.accent, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
        >
          or import from Gmail →
        </button>
      </div>
      {gmailError && mode === 'manual' && <div style={{ fontSize: 12, color: T.danger, textAlign: 'center' }}>{gmailError}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <TextFieldPill T={T} label="Merchant" value={merchant} onChange={setMerchant} placeholder="Who you paid" />
        <TextFieldPill T={T} label="Amount" value={amount} onChange={setAmount} placeholder="0.00" inputMode="decimal" />
        <TextFieldPill T={T} label="Date" value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
        <TextFieldPill T={T} label="Category" value={category} onChange={setCategory} placeholder="e.g. travel" />
      </div>

      <Glass T={T} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: T.mode === 'dark' ? 'rgba(158,176,132,0.16)' : 'rgba(226,238,204,0.6)' }}>
        <PiggyBankIcon size={20} color={T.mode === 'dark' ? T.ramp.accent2[300] : T.ramp.accent2[800]} />
        <div style={{ flex: 1, fontSize: 12, color: T.mode === 'dark' ? T.ramp.accent2[100] : T.ramp.accent2[900] }}>
          Comes off your tax bill — <strong>saves about {formatGBP(saving)}</strong>
        </div>
      </Glass>

      <PillButton T={T} onClick={submit} disabled={amountPence <= 0}>Save cost</PillButton>
    </div>
  );
}
