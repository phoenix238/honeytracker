import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { handle } from '../router';
import { setDb, pglite, migrate, type Db } from '../db';
import type { Transaction } from '../../src/core/types';

// End-to-end through the real router and real SQL (PGlite = Postgres in WASM), with the bank
// and CSTL faked at the network boundary.

const BASE = 'https://honey.test';
let cookie = '';

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await handle(
    new Request(`${BASE}${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
  const text = await res.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* csv etc */
  }
  return { status: res.status, data, res };
}

const feed: any[] = [];
let aiReply: (prompt: string) => unknown = () => ({ results: [] });
let aiCalls = 0;
let lastAiHeaders: Record<string, string> = {};
const cstlEvents: any[] = [];

function fakeNetwork() {
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (input instanceof Request && !init) init = { body: await input.clone().text() } as RequestInit;
    if (url.endsWith('/accounts')) {
      return Response.json({ accounts: [{ accountUid: 'acc1', defaultCategory: 'cat1', name: 'Business' }] });
    }
    if (url.includes('/transactions-between')) {
      const min = new URL(url).searchParams.get('minTransactionTimestamp')!;
      const max = new URL(url).searchParams.get('maxTransactionTimestamp')!;
      return Response.json({ feedItems: feed.filter((f) => f.transactionTime >= min && f.transactionTime < max) });
    }
    if (url.startsWith('https://cstl.test/api/finance/events')) return Response.json({ events: cstlEvents });
    if (url.includes('api.anthropic.com/v1/messages')) {
      aiCalls++;
      lastAiHeaders = Object.fromEntries(new Headers((init as RequestInit | undefined)?.headers ?? (input instanceof Request ? input.headers : undefined)).entries());
      const body = JSON.parse(String((init as RequestInit | undefined)?.body ?? '{}'));
      const prompt = body.messages?.[0]?.content ?? '';
      return Response.json({
        id: 'msg_test', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: JSON.stringify(aiReply(typeof prompt === 'string' ? prompt : JSON.stringify(prompt))) }],
        usage: { input_tokens: 10, output_tokens: 10 },
      });
    }
    return new Response('not found', { status: 404 });
  });
}

function item(uid: string, pounds: number, direction: 'IN' | 'OUT', when: string, extra: Record<string, unknown> = {}) {
  return { feedItemUid: uid, amount: { minorUnits: Math.round(pounds * 100), currency: 'GBP' }, direction, transactionTime: when, status: 'SETTLED', counterPartyName: '', reference: '', source: 'FASTER_PAYMENTS_IN', ...extra };
}

let db: Db;
beforeAll(async () => {
  db = await pglite();
  await migrate(db);
}, 30_000);

beforeEach(async () => {
  process.env.APP_PASSWORD = 'correct horse';
  process.env.SESSION_SECRET = 'a-very-long-test-session-secret-value';
  process.env.CRON_SECRET = 'cron-secret';
  process.env.STARLING_TOKEN = 'starling-token';
  process.env.CSTL_URL = 'https://cstl.test';
  process.env.CSTL_FINANCE_TOKEN = 'cstl-token';
  delete process.env.ANTHROPIC_API_KEY;
  await db.query('TRUNCATE invoices, transactions, receipts, rules, streams, kv, audit_log CASCADE');
  setDb(db);
  feed.length = 0;
  cstlEvents.length = 0;
  fakeNetwork();
  cookie = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  setDb(null);
});

async function signIn() {
  const r = await call('POST', '/api/login', { password: 'correct horse' });
  expect(r.status).toBe(200);
  cookie = r.res.headers.get('set-cookie')!.split(';')[0]!;
}

const thisYear = () => {
  const now = new Date();
  return now.toISOString().slice(0, 10);
};
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

describe('auth', () => {
  it('refuses everything without a session', async () => {
    expect((await call('GET', '/api/state')).status).toBe(401);
  });
  it('rejects a wrong password', async () => {
    expect((await call('POST', '/api/login', { password: 'nope' })).status).toBe(401);
  });
  it('rejects a forged cookie', async () => {
    cookie = 'ht_session=9999999999.forged';
    expect((await call('GET', '/api/state')).status).toBe(401);
  });
  it('only lets the scheduler in with its secret', async () => {
    expect((await call('GET', '/api/cron')).status).toBe(401);
    expect((await call('GET', '/api/cron', undefined, { authorization: 'Bearer cron-secret' })).status).toBe(200);
  });
  it('refuses non-JSON mutations (no cross-site form posts)', async () => {
    await signIn();
    const res = await handle(new Request(`${BASE}/api/streams`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=x' }));
    expect(res.status).toBe(415);
  });
});

describe('the ledger', () => {
  it('syncs the bank once, however many times it runs', async () => {
    await signIn();
    feed.push(item('f1', 80, 'IN', daysAgo(3), { counterPartyName: 'SARAH JONES', reference: 'JS-4' }));
    feed.push(item('f2', 23.5, 'OUT', daysAgo(2), { counterPartyName: 'RYMAN', source: 'MASTER_CARD' }));
    feed.push(item('f3', 100, 'OUT', daysAgo(2), { source: 'INTERNAL_TRANSFER', counterPartyName: 'Tax pot' }));
    feed.push({ ...item('f4', 5, 'OUT', daysAgo(1)), status: 'PENDING' });

    const first = await call('POST', '/api/sync', {});
    expect(first.data.starling.newRows).toBe(3);
    const again = await call('POST', '/api/sync', {});
    expect(again.data.starling.newRows).toBe(0);

    const { data } = await call('GET', '/api/state');
    const byRef = (ref: string) => data.transactions.find((t: Transaction) => t.sourceId === ref);
    expect(data.transactions).toHaveLength(3);
    expect(byRef('f1').reference).toBe('JS-4'); // the reference survives
    expect(byRef('f1').bucket).toBe('unreviewed');
    expect(byRef('f3').bucket).toBe('transfer'); // Spaces moves sort themselves
  });

  it('classifies, remembers a rule, and applies it to the next one', async () => {
    await signIn();
    const stream = (await call('POST', '/api/streams', { name: 'Practice' })).data;
    feed.push(item('f1', 12, 'OUT', daysAgo(10), { counterPartyName: 'ZOOM.US 888-799', source: 'MASTER_CARD' }));
    await call('POST', '/api/sync', {});
    let { data } = await call('GET', '/api/state');
    const t = data.transactions[0];

    const patched = await call('PATCH', `/api/transactions/${t.id}`, { bucket: 'business_expense', streamId: stream.id, category: 'adminCosts' });
    expect(patched.data.classifiedBy).toBe('user');
    const rule = await call('POST', '/api/rules', { field: 'counterparty', pattern: 'zoom.us', direction: 'out', bucket: 'business_expense', streamId: stream.id, category: 'adminCosts' });
    expect(rule.status).toBe(201);

    feed.push(item('f2', 12, 'OUT', daysAgo(1), { counterPartyName: 'ZOOM.US 888-799', source: 'MASTER_CARD' }));
    const sync = await call('POST', '/api/sync', {});
    expect(sync.data.starling.autoClassified).toBe(1);
    ({ data } = await call('GET', '/api/state'));
    const next = data.transactions.find((x: Transaction) => x.sourceId === 'f2');
    expect(next).toMatchObject({ bucket: 'business_expense', category: 'adminCosts', streamId: stream.id, classifiedBy: 'rule' });

    const history = await call('GET', `/api/transactions/${t.id}/history`);
    expect(history.data.map((h: any) => h.action)).toEqual(['create', 'update']);
  });

  it('validates what it is given', async () => {
    await signIn();
    feed.push(item('f1', 12, 'OUT', daysAgo(1)));
    await call('POST', '/api/sync', {});
    const t = (await call('GET', '/api/state')).data.transactions[0];
    expect((await call('PATCH', `/api/transactions/${t.id}`, { bucket: 'free money' })).status).toBe(400);
    expect((await call('PATCH', `/api/transactions/${t.id}`, { category: 'yachts' })).status).toBe(400);
    expect((await call('PATCH', `/api/transactions/${t.id}`, { businessPercent: 140 })).status).toBe(400);
    // Bank rows can't be deleted or have their facts rewritten.
    expect((await call('DELETE', `/api/transactions/${t.id}`)).status).toBe(400);
    const edited = await call('PATCH', `/api/transactions/${t.id}`, { amountPence: 1 });
    expect(edited.data.amountPence).toBe(1200);
  });

  it('records cash, and lets you delete what you typed', async () => {
    await signIn();
    const r = await call('POST', '/api/transactions', { date: thisYear(), amountPence: 4000, direction: 'in', counterparty: 'Cash client', bucket: 'business_income' });
    expect(r.status).toBe(201);
    expect(r.data.source).toBe('cash');
    expect((await call('DELETE', `/api/transactions/${r.data.id}`)).status).toBe(200);
  });
});

describe('CSTL', () => {
  it('labels bank payments CSTL matched, adds cash sessions, and lists card ones without adding them', async () => {
    await signIn();
    feed.push(item('bank-1', 80, 'IN', daysAgo(5), { counterPartyName: 'S JONES', reference: 'JS-4' }));
    cstlEvents.push(
      { bookingId: 'b1', paidAt: daysAgo(5), amountPence: 8000, method: 'bank', feedItemUid: 'bank-1', paymentRef: 'JS-4', receiptNumber: 'RCT-1', clinic: 'Waterloo', note: '' },
      { bookingId: 'b2', paidAt: daysAgo(4), amountPence: 4500, method: 'cash', feedItemUid: null, paymentRef: 'AB-2', receiptNumber: '', clinic: 'Bethnal Green', note: 'Cash' },
      { bookingId: 'b3', paidAt: daysAgo(3), amountPence: 6000, method: 'other', feedItemUid: null, paymentRef: 'CD-3', receiptNumber: '', clinic: 'Waterloo', note: 'Card' },
      { bookingId: 'b4', paidAt: daysAgo(3), amountPence: null, method: 'cash', feedItemUid: null, paymentRef: 'EF-5', receiptNumber: '', clinic: 'Bethnal Green', note: '' },
    );
    const sync = await call('POST', '/api/sync', {});
    expect(sync.data.cstl).toMatchObject({ matchedBank: 1, cashRows: 1, otherPaid: 1, unpricedSkipped: 1 });

    let { data } = await call('GET', '/api/state');
    const stream = data.streams.find((s: any) => s.name === 'CSTL practice');
    expect(data.settings.cstlStreamId).toBe(stream.id);
    const bank = data.transactions.find((t: Transaction) => t.sourceId === 'bank-1');
    expect(bank).toMatchObject({ bucket: 'business_income', streamId: stream.id, classifiedBy: 'cstl' });
    expect(bank.meta.cstlBookingId).toBe('b1');
    expect(data.transactions.filter((t: Transaction) => t.source === 'cstl')).toHaveLength(1);
    expect(data.cstlOther.map((o: any) => o.bookingId)).toEqual(['b3']);

    // Running again changes nothing.
    const again = await call('POST', '/api/sync', {});
    expect(again.data.cstl).toMatchObject({ matchedBank: 0, cashRows: 0 });

    // The cash session is later marked unpaid in CSTL → it goes back to review.
    cstlEvents.splice(1, 1);
    const third = await call('POST', '/api/sync', {});
    expect(third.data.cstl.voided).toBe(1);
    ({ data } = await call('GET', '/api/state'));
    expect(data.transactions.find((t: Transaction) => t.source === 'cstl').bucket).toBe('unreviewed');

    // "It's already in the bank" takes a card session off the list for good.
    await call('POST', '/api/cstl/dismiss', { bookingId: 'b3' });
    await call('POST', '/api/sync', {});
    ({ data } = await call('GET', '/api/state'));
    expect(data.cstlOther).toEqual([]);
  });

  it('never overrides a classification you made yourself', async () => {
    await signIn();
    feed.push(item('bank-1', 80, 'IN', daysAgo(5)));
    await call('POST', '/api/sync', {});
    const t = (await call('GET', '/api/state')).data.transactions[0];
    await call('PATCH', `/api/transactions/${t.id}`, { bucket: 'personal' });
    cstlEvents.push({ bookingId: 'b1', paidAt: daysAgo(5), amountPence: 8000, method: 'bank', feedItemUid: 'bank-1', paymentRef: 'JS-4', receiptNumber: '', clinic: 'Waterloo', note: '' });
    await call('POST', '/api/sync', {});
    const after = (await call('GET', '/api/state')).data.transactions[0];
    expect(after.bucket).toBe('personal');
    expect(after.meta.cstlBookingId).toBe('b1');
  });
});

describe('receipts', () => {
  it('stores a receipt, serves it back, and matches it once the details are known', async () => {
    await signIn();
    feed.push(item('f1', 23.5, 'OUT', daysAgo(2), { counterPartyName: 'RYMAN' }));
    await call('POST', '/api/sync', {});
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64').toString('base64');
    const up = await call('POST', '/api/receipts', { filename: 'r.png', mime: 'image/png', dataBase64: png });
    expect(up.status).toBe(201);
    expect(up.data.read).toBe(false); // no AI key in tests
    const file = await handle(new Request(`${BASE}/api/receipts/${up.data.receipt.id}/file`, { headers: { cookie } }));
    expect(file.headers.get('content-type')).toBe('image/png');

    const txn = (await call('GET', '/api/state')).data.transactions[0];
    await call('PATCH', `/api/receipts/${up.data.receipt.id}`, { totalPence: 2350, date: txn.date });
    await call('POST', '/api/sync', {}); // loose receipts get another go at matching
    const state = (await call('GET', '/api/state')).data;
    expect(state.receipts[0].transactionId).toBe(txn.id);
    expect(state.transactions[0].receiptIds).toEqual([up.data.receipt.id]);
  });

  it('turns a cash receipt into its own expense row', async () => {
    await signIn();
    const up = await call('POST', '/api/receipts', { filename: 'r.pdf', mime: 'application/pdf', dataBase64: Buffer.from('%PDF-1.4').toString('base64') });
    const t = await call('POST', `/api/receipts/${up.data.receipt.id}/expense`, { streamId: null, category: 'carVanTravelExpenses', date: thisYear(), amountPence: 1250 });
    expect(t.status).toBe(201);
    expect(t.data).toMatchObject({ bucket: 'business_expense', source: 'cash', category: 'carVanTravelExpenses', receiptIds: [up.data.receipt.id] });
  });

  it('refuses things that are not receipts', async () => {
    await signIn();
    expect((await call('POST', '/api/receipts', { filename: 'x.html', mime: 'text/html', dataBase64: 'PGgxPg==' })).status).toBe(400);
  });
});

describe('import from the old app', () => {
  it('links records to their bank twin, adds the rest once, and never duplicates', async () => {
    await signIn();
    feed.push(item('f1', 80, 'IN', daysAgo(20)));
    await call('POST', '/api/sync', {});
    const bankDate = (await call('GET', '/api/state')).data.transactions[0].date;
    const items = [
      { sourceId: 'honeypot:entry:e1', kind: 'income', date: bankDate, amountPence: 8000, label: 'Sarah — Session', category: null, imageDataUrl: null },
      { sourceId: 'honeypot:entry:e2', kind: 'income', date: bankDate, amountPence: 4000, label: 'Cash client', category: null, imageDataUrl: null },
      { sourceId: 'honeypot:receipt:r1', kind: 'expense', date: bankDate, amountPence: 999, label: 'Ryman', category: 'adminCosts', imageDataUrl: 'data:image/png;base64,AAAA' },
    ];
    const first = await call('POST', '/api/import', { items, streamId: null });
    expect(first.data).toMatchObject({ linked: 1, created: 2, receipts: 1 });
    const second = await call('POST', '/api/import', { items, streamId: null });
    expect(second.data).toMatchObject({ linked: 0, created: 0, skipped: 3, already: 3, unreadable: 0 });
    const { data } = await call('GET', '/api/state');
    expect(data.transactions).toHaveLength(3);
    expect(data.transactions.find((t: Transaction) => t.sourceId === 'f1').bucket).toBe('business_income');
  });
});

describe('invoices', () => {
  const lines = [{ description: 'Filming, half day', quantity: 1, unitPence: 25000 }, { description: 'Edit', quantity: 2.5, unitPence: 4000 }];

  it('numbers, sends, and is paid by the bank payment that quotes it', async () => {
    await signIn();
    await call('PUT', '/api/settings', { profile: { businessName: 'Phoenix Media', sortCode: '60-83-71', accountNumber: '12345678' }, nextInvoiceNumber: 42 });
    const stream = (await call('POST', '/api/streams', { name: 'Media' })).data;
    const a = (await call('POST', '/api/invoices', { clientName: 'Studio Ltd', streamId: stream.id, lines })).data;
    const b = (await call('POST', '/api/invoices', { clientName: 'Other', lines })).data;
    expect([a.number, b.number]).toEqual(['INV-0042', 'INV-0043']);

    // Can't send without a client.
    const empty = (await call('POST', '/api/invoices', {})).data;
    expect((await call('PATCH', `/api/invoices/${empty.id}`, { status: 'sent' })).status).toBe(400);
    expect((await call('DELETE', `/api/invoices/${empty.id}`)).status).toBe(200);

    expect((await call('PATCH', `/api/invoices/${a.id}`, { status: 'sent' })).data.status).toBe('sent');
    const pdf = await handle(new Request(`${BASE}/api/invoices/${a.id}/pdf`, { headers: { cookie } }));
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF');

    // £250 + 2.5 × £40 = £350, paid with the reference.
    feed.push(item('pay-1', 350, 'IN', daysAgo(0), { counterPartyName: 'STUDIO LTD', reference: 'inv0042' }));
    const sync = await call('POST', '/api/sync', {});
    expect(sync.data.invoicesPaid).toBe(1);
    const state = (await call('GET', '/api/state')).data;
    const paid = state.invoices.find((i: any) => i.id === a.id);
    const row = state.transactions.find((t: Transaction) => t.sourceId === 'pay-1');
    expect(paid.paidTransactionId).toBe(row.id);
    expect(row).toMatchObject({ bucket: 'business_income', streamId: stream.id, classifiedBy: 'invoice' });

    // A paid invoice is locked, and prints as a receipt.
    expect((await call('PATCH', `/api/invoices/${a.id}`, { notes: 'x' })).status).toBe(400);
    const receipt = await handle(new Request(`${BASE}/api/invoices/${a.id}/pdf`, { headers: { cookie } }));
    expect(receipt.headers.get('content-disposition')).toContain('receipt-INV-0042');
  });

  it('records cash, links a chosen bank payment, and can be unpaid again', async () => {
    await signIn();
    const inv = (await call('POST', '/api/invoices', { clientName: 'Café', lines })).data;
    await call('PATCH', `/api/invoices/${inv.id}`, { status: 'sent' });
    const cash = await call('POST', `/api/invoices/${inv.id}/pay`, { date: thisYear() });
    expect(cash.data.transaction).toMatchObject({ source: 'cash', amountPence: 35000, bucket: 'business_income' });
    await call('POST', `/api/invoices/${inv.id}/unpay`, {});
    let state = (await call('GET', '/api/state')).data;
    expect(state.transactions).toHaveLength(0); // the cash row went with it

    feed.push(item('pay-2', 350, 'IN', daysAgo(0), { counterPartyName: 'CAFE' }));
    await call('POST', '/api/sync', {});
    expect((await call('GET', '/api/state')).data.invoices[0].paidTransactionId).toBeNull(); // no reference: not automatic
    const candidates = (await call('GET', `/api/invoices/${inv.id}/candidates`)).data;
    expect(candidates).toHaveLength(1);
    await call('POST', `/api/invoices/${inv.id}/pay`, { transactionId: candidates[0].id });
    await call('POST', `/api/invoices/${inv.id}/unpay`, {});
    state = (await call('GET', '/api/state')).data;
    expect(state.transactions).toHaveLength(1); // a bank row is never deleted
    expect(state.transactions[0].meta.invoiceId).toBe('');
  });

  it('only deletes drafts', async () => {
    await signIn();
    const inv = (await call('POST', '/api/invoices', { clientName: 'X', lines })).data;
    await call('PATCH', `/api/invoices/${inv.id}`, { status: 'sent' });
    expect((await call('DELETE', `/api/invoices/${inv.id}`)).status).toBe(400);
  });

  it('reports storage use', async () => {
    await signIn();
    const { data } = await call('GET', '/api/state');
    expect(data.storage.usedBytes).toBeGreaterThan(0);
    expect(data.storage.limitBytes).toBe(512 * 1024 * 1024);
  });
});

describe('AI sorting', () => {
  it('sorts the backlog for checking, ignores nonsense, and never overrides you', async () => {
    await signIn();
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const stream = (await call('POST', '/api/streams', { name: 'Media' })).data;
    feed.push(item('a1', 350, 'IN', daysAgo(4), { counterPartyName: 'STUDIO LTD', reference: 'INV-0017' }));
    feed.push(item('a2', 12.99, 'OUT', daysAgo(3), { counterPartyName: 'ADOBE' }));
    feed.push(item('a3', 42.5, 'OUT', daysAgo(2), { counterPartyName: 'TESCO' }));
    feed.push(item('a4', 5, 'OUT', daysAgo(1), { counterPartyName: 'MYSTERY' }));
    await call('POST', '/api/sync', {});
    const rows = (await call('GET', '/api/state')).data.transactions as Transaction[];
    const id = (uid: string) => rows.find((t) => t.sourceId === uid)!.id;
    // You sort one yourself while the AI works.
    await call('PATCH', `/api/transactions/${id('a3')}`, { bucket: 'personal' });

    aiReply = (prompt) => {
      expect(prompt).toContain('Media'); // it's told your streams
      return {
        results: [
          { id: id('a1'), bucket: 'business_income', streamId: stream.id, category: '', businessPercent: 100, confidence: 'high', reason: 'Invoice payment' },
          { id: id('a2'), bucket: 'business_expense', streamId: stream.id, category: 'adminCosts', businessPercent: 140, confidence: 'medium', reason: 'Software' },
          { id: 'not-a-row', bucket: 'business_income', streamId: '', category: '', businessPercent: 100, confidence: 'high', reason: 'x' },
          // a4 left out: the AI skipped it
        ],
      };
    };
    aiCalls = 0;
    process.env.ANTHROPIC_WORKSPACE_ID = 'wrkspc_test';
    const r = await call('POST', '/api/ai/sort', {});
    expect(r.data).toMatchObject({ sorted: 2, skipped: 1, remaining: 0 });
    expect(lastAiHeaders['anthropic-workspace-id']).toBe('wrkspc_test');
    delete process.env.ANTHROPIC_WORKSPACE_ID;
    const after = (await call('GET', '/api/state')).data.transactions as Transaction[];
    const get = (uid: string) => after.find((t) => t.sourceId === uid)!;
    expect(get('a1')).toMatchObject({ bucket: 'business_income', streamId: stream.id, classifiedBy: 'ai' });
    expect(get('a1').meta.aiConfidence).toBe('high');
    expect(get('a2')).toMatchObject({ category: 'adminCosts', businessPercent: 100 }); // clamped
    expect(get('a3')).toMatchObject({ bucket: 'personal', classifiedBy: 'user' });
    expect(get('a4').bucket).toBe('unreviewed');

    // The skipped row isn't offered again, so the loop ends.
    const again = await call('POST', '/api/ai/sort', {});
    expect(again.data).toMatchObject({ sorted: 0, remaining: 0 });
    expect(aiCalls).toBe(1);

    // Confirming turns the AI's choice into yours.
    await call('POST', '/api/transactions/bulk', { ids: [get('a1').id, get('a2').id], patch: {} });
    const confirmed = (await call('GET', '/api/state')).data.transactions as Transaction[];
    expect(confirmed.filter((t) => t.classifiedBy === 'ai')).toHaveLength(0);
    expect(confirmed.find((t) => t.sourceId === 'a2')).toMatchObject({ bucket: 'business_expense', category: 'adminCosts' });
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('says what to set up when there is no API key', async () => {
    await signIn();
    expect((await call('POST', '/api/ai/sort', {})).data.error).toContain('ANTHROPIC_API_KEY');
  });
});

describe('import safety', () => {
  it('never stores a non-image as a receipt, and cleans unknown categories', async () => {
    await signIn();
    const items = [
      { sourceId: 'honeypot:receipt:x', kind: 'expense', date: '2026-05-01', amountPence: 500, label: 'Evil', category: 'yachts', imageDataUrl: 'data:text/html;base64,PHNjcmlwdD4=' },
    ];
    const r = await call('POST', '/api/import', { items, streamId: null });
    expect(r.data).toMatchObject({ created: 1, receipts: 0 });
    const { data } = await call('GET', '/api/state');
    expect(data.transactions[0].category).toBe('otherExpenses');
    expect(data.receipts).toHaveLength(0);
  });
});

describe('export', () => {
  it('downloads the year as CSV', async () => {
    await signIn();
    await call('POST', '/api/transactions', { date: thisYear(), amountPence: 4000, direction: 'in', counterparty: '=HYPERLINK("x")', bucket: 'business_income' });
    const { data, res } = await call('GET', '/api/export.csv');
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(data).toContain("'=HYPERLINK"); // formula injection neutralised
  });

  it('routes through the Vercel rewrite path', async () => {
    await signIn();
    const r = await call('GET', '/api?__path=state');
    expect(r.status).toBe(200);
  });
});

describe('AI and imported streams', () => {
  it('picks a stream for imported records, and can re-stream an import filed under one stream', async () => {
    await signIn();
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const cranio = (await call('POST', '/api/streams', { name: 'Cranio' })).data;
    const media = (await call('POST', '/api/streams', { name: 'Media' })).data;
    const items = [
      { sourceId: 'honeypot:entry:1', kind: 'income', date: '2026-05-01', amountPence: 6000, label: 'Sam — session', category: null, imageDataUrl: null },
      { sourceId: 'honeypot:entry:2', kind: 'income', date: '2026-05-02', amountPence: 25000, label: 'Studio Ltd — shoot', category: null, imageDataUrl: null },
    ];
    // "Sort streams later": no stream on import.
    await call('POST', '/api/import', { items, streamId: null });
    let rows = (await call('GET', '/api/state')).data.transactions as Transaction[];
    expect(rows.every((t) => t.streamId === null && t.bucket === 'business_income')).toBe(true);

    const byLabel = (list: Transaction[], l: string) => list.find((t) => t.counterparty.startsWith(l))!;
    aiReply = (prompt) => {
      expect(prompt).toContain('needs a stream');
      return {
        results: [
          { id: byLabel(rows, 'Sam').id, bucket: 'business_income', streamId: cranio.id, category: '', businessPercent: 100, confidence: 'high', reason: 'Session' },
          { id: byLabel(rows, 'Studio').id, bucket: 'business_income', streamId: media.id, category: '', businessPercent: 100, confidence: 'high', reason: 'Shoot' },
        ],
      };
    };
    const r = await call('POST', '/api/ai/sort', {});
    expect(r.data.sorted).toBe(2);
    rows = (await call('GET', '/api/state')).data.transactions;
    expect(byLabel(rows, 'Sam').streamId).toBe(cranio.id);
    expect(byLabel(rows, 'Studio').streamId).toBe(media.id);

    // An earlier import filed everything under one stream: queue it for re-streaming.
    const items2 = [{ sourceId: 'honeypot:entry:3', kind: 'income', date: '2026-05-03', amountPence: 1500, label: 'Café — shift', category: null, imageDataUrl: null }];
    await call('POST', '/api/import', { items: items2, streamId: cranio.id });
    const marked = await call('POST', '/api/ai/restream-imports', {});
    expect(marked.data.marked).toBe(1); // only the one still marked as imported
    rows = (await call('GET', '/api/state')).data.transactions;
    aiReply = () => ({ results: [{ id: byLabel(rows, 'Café').id, bucket: 'business_income', streamId: media.id, category: '', businessPercent: 100, confidence: 'medium', reason: 'x' }] });
    expect((await call('POST', '/api/ai/sort', {})).data.sorted).toBe(1);
    rows = (await call('GET', '/api/state')).data.transactions;
    expect(byLabel(rows, 'Café')).toMatchObject({ streamId: media.id, classifiedBy: 'ai' });
    delete process.env.ANTHROPIC_API_KEY;
  });
});

describe('AI examples', () => {
  it('learns from your own sorting first, then what the old app carried over', async () => {
    const { pickExamples } = await import('../aiSort');
    const { txn } = await import('../../src/core/__tests__/fixtures');
    const rows = [
      txn({ counterparty: 'RYMAN', bucket: 'business_expense', classifiedBy: 'import', streamId: 's1' }),
      txn({ counterparty: 'ZOOM', bucket: 'business_expense', classifiedBy: 'user' }),
      txn({ counterparty: 'TESCO', bucket: 'personal', classifiedBy: 'ai' }),
      txn({ counterparty: 'ADOBE', bucket: 'unreviewed', classifiedBy: null }),
    ];
    expect(pickExamples(rows).map((t) => t.counterparty)).toEqual(['ZOOM', 'RYMAN']);
  });
});

describe('AI examples skip imports whose stream is unknown', () => {
  it('does not learn a stream from an import that has none or is being re-chosen', async () => {
    const { pickExamples } = await import('../aiSort');
    const { txn } = await import('../../src/core/__tests__/fixtures');
    const rows = [
      txn({ counterparty: 'A', bucket: 'business_income', classifiedBy: 'import', streamId: null }),
      txn({ counterparty: 'B', bucket: 'business_income', classifiedBy: 'import', streamId: 's1', meta: { aiRestream: '1' } }),
      txn({ counterparty: 'C', bucket: 'business_income', classifiedBy: 'import', streamId: 's1' }),
    ];
    expect(pickExamples(rows).map((t) => t.counterparty)).toEqual(['C']);
  });
});
