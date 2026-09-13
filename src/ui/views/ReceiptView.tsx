import { useRef, useState } from 'react';
import { formatGBP, parsePence, percentOf } from '../../core/money';
import { mkId } from '../../core/id';
import { today } from '../../core/dates';
import type { Expense } from '../../core/types';
import { repository } from '../../storage/repository';
import { pageBackground, type Theme } from '../theme';
import { Glass } from '../components/Glass';
import { TextFieldPill } from '../components/FieldRow';
import { PillButton } from '../components/PillButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { CameraIcon, CheckIcon, PiggyBankIcon } from '../icons';
import type { Store } from '../useStore';

export function ReceiptView({ store, T, onDone }: { store: Store; T: Theme; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [category, setCategory] = useState('');

  const amountPence = parsePence(amount);
  const saving = percentOf(amountPence, store.settings.taxPercent);

  const pickPhoto = (file: File) => {
    setPhoto(file);
    setPreviewUrl(URL.createObjectURL(file));
    if (!merchant) setMerchant('');
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
            if (f) pickPhoto(f);
            e.target.value = '';
          }}
        />
      </div>

      <div style={{ textAlign: 'center', fontSize: 12, color: T.textMuted }}>Fill in what's on the receipt</div>

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
