import { useState } from 'react';
import { fonts, type Theme } from '../theme';
import { parsePence } from '../../core/money';
import { mkId } from '../../core/id';
import type { Client } from '../../core/types';
import { Glass } from './Glass';
import { Avatar } from './Avatar';
import { ChevronRightIcon, PlusIcon } from '../icons';

export interface PickedClient {
  clientId?: string;
  name: string;
  email?: string;
  defaultRatePence?: number;
}

/**
 * The client field everywhere one is needed (Log work, Invoice): a saved-client picker first,
 * a one-off name only as a fallback — so making an invoice means selecting someone, not
 * retyping their details every time.
 */
export function ClientPicker({
  T,
  clients,
  value,
  onChange,
  onSaveClient,
}: {
  T: Theme;
  clients: Client[];
  value: PickedClient;
  onChange: (v: PickedClient) => void;
  onSaveClient: (client: Client) => void;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRate, setNewRate] = useState('');

  const pick = (c: Client) => {
    onChange({ clientId: c.id, name: c.name, email: c.email, defaultRatePence: c.defaultRatePence });
    setOpen(false);
  };

  const saveNew = () => {
    if (!newName.trim()) return;
    const client: Client = {
      id: mkId(),
      name: newName.trim(),
      email: newEmail.trim() || undefined,
      defaultRatePence: newRate ? parsePence(newRate) : undefined,
      createdAt: new Date().toISOString(),
    };
    onSaveClient(client);
    pick(client);
    setAdding(false);
    setNewName('');
    setNewEmail('');
    setNewRate('');
  };

  return (
    <div>
      <Glass
        T={T}
        pill
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px 10px 10px', cursor: 'pointer' }}
      >
        <div onClick={() => setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
          <Avatar label={value.name || '?'} size={38} bg={T.ramp.accent2[T.mode === 'dark' ? 600 : 400]} color={T.mode === 'dark' ? T.ramp.accent2[100] : T.ramp.accent2[900]} />
          <span style={{ flex: 1, fontWeight: 700, fontSize: 14, color: value.name ? T.text : T.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {value.name || 'Choose a client'}
          </span>
          <ChevronRightIcon size={18} color={T.textMuted} />
        </div>
      </Glass>

      {open && (
        <Glass T={T} style={{ marginTop: 6, padding: 8, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
          {clients.length === 0 && !adding && (
            <div style={{ fontSize: 12, color: T.textMuted, textAlign: 'center', padding: '10px 4px' }}>No saved clients yet.</div>
          )}
          {clients.map((c) => (
            <button
              key={c.id}
              onClick={() => pick(c)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px', borderRadius: 12, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
            >
              <Avatar label={c.name} size={30} bg={T.ramp.accent[T.mode === 'dark' ? 600 : 300]} color={T.mode === 'dark' ? T.ramp.accent[100] : T.ramp.accent[900]} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{c.name}</div>
                {c.email && <div style={{ fontSize: 11, color: T.textMuted }}>{c.email}</div>}
              </div>
            </button>
          ))}

          {!adding ? (
            <button
              onClick={() => setAdding(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 8px', borderRadius: 12, background: 'none', border: `1px dashed ${T.border}`, color: T.accent, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              <PlusIcon size={14} color={T.accent} /> New client
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8 }}>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name"
                style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 999, padding: '8px 12px', fontSize: 13, color: T.text, fontFamily: fonts.body }}
              />
              <input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="Email (optional)"
                style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 999, padding: '8px 12px', fontSize: 13, color: T.text, fontFamily: fonts.body }}
              />
              <input
                value={newRate}
                onChange={(e) => setNewRate(e.target.value)}
                placeholder="Usual rate, e.g. 480 (optional)"
                inputMode="decimal"
                style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 999, padding: '8px 12px', fontSize: 13, color: T.text, fontFamily: fonts.body }}
              />
              <button
                onClick={saveNew}
                disabled={!newName.trim()}
                style={{ background: T.accent, color: T.accentOn, border: 'none', borderRadius: 999, padding: '9px', fontSize: 13, fontWeight: 700, cursor: newName.trim() ? 'pointer' : 'not-allowed', opacity: newName.trim() ? 1 : 0.5, fontFamily: fonts.display }}
              >
                Save client
              </button>
            </div>
          )}
        </Glass>
      )}
    </div>
  );
}
