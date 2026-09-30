import { useEffect, useState } from 'react';
import { T } from './theme';
import { Button, Sheet } from './components';
import { receiptFileUrl } from './api';
import { shareOrDownload } from './download';
import type { Receipt } from '../core/types';

// Looking at a receipt without leaving the app. On an iPhone home-screen app, following a link
// to the file replaces the whole app with it and there's no back button — so photos, PDFs and
// emails all open here, over the screen you were on, and close with ×.

export function ReceiptViewer({ receipt, onClose }: { receipt: Receipt | null; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  const url = receipt ? receiptFileUrl(receipt.id) : '';
  const kind = !receipt ? null : receipt.mime.startsWith('image/') ? 'image' : receipt.mime === 'application/pdf' ? 'pdf' : 'text';

  useEffect(() => {
    setText(null);
    setError('');
    if (kind !== 'text') return;
    fetch(url, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`the server said ${r.status}`))))
      .then(setText)
      .catch((e: Error) => setError(e.message));
  }, [url, kind]);

  if (!receipt) return null;
  return (
    <Sheet open onClose={onClose} title={receipt.merchant || receipt.filename || 'Receipt'}>
      {kind === 'image' && <img src={url} alt="Receipt" style={{ width: '100%', borderRadius: 10, background: T.surface }} />}
      {kind === 'pdf' && (
        <iframe title="Receipt PDF" src={url} style={{ width: '100%', height: '62vh', border: `1px solid ${T.border}`, borderRadius: 10, background: '#fff' }} />
      )}
      {kind === 'text' && (
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, lineHeight: 1.5, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12, margin: 0, maxHeight: '62vh', overflowY: 'auto' }}>
          {error ? `Couldn’t open it — ${error}` : text ?? 'Opening…'}
        </pre>
      )}
      {kind !== 'text' && (
        <Button tone="quiet" onClick={() => shareOrDownload(url, receipt.filename || 'receipt', receipt.mime).catch(() => undefined)}>
          See it full size, save or share it
        </Button>
      )}
      <Button onClick={onClose}>Back</Button>
    </Sheet>
  );
}
