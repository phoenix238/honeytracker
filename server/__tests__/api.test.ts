import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { handle } from '../router';
import { setDb, pglite, migrate, type Db } from '../db';
import { repo } from '../repo';
import type { InvoiceLine, Transaction } from '../../src/core/types';

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

  it('titles a CSTL cash session as cash, so it reads as cash in every list', async () => {
    await signIn();
    cstlEvents.push({ bookingId: 'c1', paidAt: daysAgo(2), amountPence: 6000, method: 'cash', feedItemUid: null, paymentRef: 'JS-4', receiptNumber: '', clinic: 'Waterloo', note: 'Cash' });
    await call('POST', '/api/sync', {});
    const row = (await call('GET', '/api/state')).data.transactions.find((t: Transaction) => t.source === 'cstl');
    expect(row).toMatchObject({ counterparty: 'Cash · CSTL client JS-4', bucket: 'business_income', meta: { method: 'cash' } });
  });

  it('lists a transfer CSTL marked paid without picking the payment, and files the line you point at', async () => {
    await signIn();
    feed.push(item('tx-1', 60, 'IN', daysAgo(6), { counterPartyName: 'MRS K JONES', reference: 'thanks' }));
    cstlEvents.push({ bookingId: 'u1', paidAt: daysAgo(2), amountPence: 6000, method: 'bank', feedItemUid: null, paymentRef: 'KJ-7', receiptNumber: '', clinic: 'Waterloo', note: 'Bank transfer' });
    const sync = await call('POST', '/api/sync', {});
    expect(sync.data.cstl).toMatchObject({ bankUnlinked: 1, matchedBank: 0, cashRows: 0 });

    let { data } = await call('GET', '/api/state');
    // Never added as a row of its own — the money is already here once, as the bank line.
    expect(data.transactions.filter((t: Transaction) => t.source === 'cstl')).toHaveLength(0);
    expect(data.cstlBankUnlinked).toMatchObject([{ bookingId: 'u1', amountPence: 6000, paymentRef: 'KJ-7' }]);

    const line = data.transactions.find((t: Transaction) => t.sourceId === 'tx-1');
    const linked = await call('POST', '/api/cstl/link', { bookingId: 'u1', transactionId: line.id });
    expect(linked.status).toBe(200);
    ({ data } = await call('GET', '/api/state'));
    expect(data.transactions.find((t: Transaction) => t.id === line.id)).toMatchObject({
      bucket: 'business_income', streamId: data.settings.cstlStreamId, classifiedBy: 'user', meta: { cstlBookingId: 'u1', cstlRef: 'KJ-7' },
    });
    expect(data.cstlBankUnlinked).toEqual([]);

    // The next sync sees it's linked and doesn't list it again.
    const again = await call('POST', '/api/sync', {});
    expect(again.data.cstl.bankUnlinked).toBe(0);
  });

  it('won\'t tie one bank line to two sessions, or a CSTL row to a session', async () => {
    await signIn();
    feed.push(item('tx-1', 60, 'IN', daysAgo(3)));
    cstlEvents.push(
      { bookingId: 'u1', paidAt: daysAgo(2), amountPence: 6000, method: 'bank', feedItemUid: null, paymentRef: 'A-1', receiptNumber: '', clinic: 'Waterloo', note: '' },
      { bookingId: 'u2', paidAt: daysAgo(2), amountPence: 6000, method: 'bank', feedItemUid: null, paymentRef: 'B-2', receiptNumber: '', clinic: 'Waterloo', note: '' },
      { bookingId: 'c1', paidAt: daysAgo(2), amountPence: 6000, method: 'cash', feedItemUid: null, paymentRef: 'C-3', receiptNumber: '', clinic: 'Waterloo', note: 'Cash' },
    );
    await call('POST', '/api/sync', {});
    const { data } = await call('GET', '/api/state');
    const line = data.transactions.find((t: Transaction) => t.sourceId === 'tx-1');
    const cash = data.transactions.find((t: Transaction) => t.source === 'cstl');
    expect((await call('POST', '/api/cstl/link', { bookingId: 'u1', transactionId: line.id })).status).toBe(200);
    expect((await call('POST', '/api/cstl/link', { bookingId: 'u2', transactionId: line.id })).status).toBe(409);
    expect((await call('POST', '/api/cstl/link', { bookingId: 'u2', transactionId: cash.id })).status).toBe(400);
  });

  it('"sorted already" takes an unlinked transfer off the list for good', async () => {
    await signIn();
    cstlEvents.push({ bookingId: 'u1', paidAt: daysAgo(2), amountPence: 6000, method: 'bank', feedItemUid: null, paymentRef: 'A-1', receiptNumber: '', clinic: 'Waterloo', note: '' });
    await call('POST', '/api/sync', {});
    await call('POST', '/api/cstl/dismiss', { bookingId: 'u1' });
    expect((await call('GET', '/api/state')).data.cstlBankUnlinked).toEqual([]);
    const again = await call('POST', '/api/sync', {});
    expect(again.data.cstl.bankUnlinked).toBe(0);
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

describe('invoices', () => {
  const lines = [{ description: 'Filming, half day', quantity: 1, unitPence: 25000 }, { description: 'Edit', quantity: 2.5, unitPence: 4000 }];

  it('numbers, sends, and is paid by the bank payment that quotes it', async () => {
    await signIn();
    await call('PUT', '/api/settings', { profile: { businessName: 'Phoenix Media', sortCode: '60-83-71', accountNumber: '12345678' }, nextInvoiceNumber: 42 });
    const stream = (await call('POST', '/api/streams', { name: 'Media' })).data;
    const a = (await call('POST', '/api/invoices', { clientName: 'Studio Ltd', streamId: stream.id, lines })).data;
    const b = (await call('POST', '/api/invoices', { clientName: 'Other', lines })).data;
    expect([a.number, b.number]).toEqual(['INV42', 'INV43']); // no padding zeros

    // Can't send without a client.
    const empty = (await call('POST', '/api/invoices', {})).data;
    expect((await call('PATCH', `/api/invoices/${empty.id}`, { status: 'sent' })).status).toBe(400);
    expect((await call('DELETE', `/api/invoices/${empty.id}`)).status).toBe(200);

    expect((await call('PATCH', `/api/invoices/${a.id}`, { status: 'sent' })).data.status).toBe('sent');
    const pdf = await handle(new Request(`${BASE}/api/invoices/${a.id}/pdf`, { headers: { cookie } }));
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF');

    // £250 + 2.5 × £40 = £350, paid with the reference.
    feed.push(item('pay-1', 350, 'IN', daysAgo(0), { counterPartyName: 'STUDIO LTD', reference: 'inv 42' }));
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
    expect(receipt.headers.get('content-disposition')).toContain('receipt-INV42');
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

  it('offers payments that are a little off, closest first, and links the one you pick', async () => {
    await signIn();
    const inv = (await call('POST', '/api/invoices', { clientName: 'Café', lines })).data;
    await call('PATCH', `/api/invoices/${inv.id}`, { status: 'sent' });
    feed.push(item('short-1', 345, 'IN', daysAgo(0), { counterPartyName: 'CAFE' })); // £5 short
    feed.push(item('other-1', 20, 'IN', daysAgo(0), { counterPartyName: 'SOMEONE' }));
    await call('POST', '/api/sync', {});
    expect((await call('GET', '/api/state')).data.invoices[0].paidTransactionId).toBeNull(); // not the exact amount: never automatic
    const candidates = (await call('GET', `/api/invoices/${inv.id}/candidates`)).data;
    expect(candidates.map((t: Transaction) => t.sourceId)).toEqual(['short-1', 'other-1']);
    const paid = await call('POST', `/api/invoices/${inv.id}/pay`, { transactionId: candidates[0].id });
    expect(paid.data.invoice.paidTransactionId).toBe(candidates[0].id);
    expect(paid.data.transaction).toMatchObject({ amountPence: 34500, bucket: 'business_income', classifiedBy: 'user' });
    // Once it settles an invoice it isn't offered for another.
    const next = (await call('POST', '/api/invoices', { clientName: 'Café', lines })).data;
    await call('PATCH', `/api/invoices/${next.id}`, { status: 'sent' });
    expect((await call('GET', `/api/invoices/${next.id}/candidates`)).data.map((t: Transaction) => t.sourceId)).toEqual(['other-1']);
  });

  it('keeps the day worked and start–end times on each line, and prints them', async () => {
    await signIn();
    const inv = (await call('POST', '/api/invoices', {
      clientName: 'Ethical Caff',
      lines: [
        { description: 'Shift', quantity: 3, unitPence: 1350, date: '2026-09-03', start: '9:30', end: '12:30' },
        { description: 'Shift', quantity: 2, unitPence: 1350, date: '2026-09-04', start: '10:00', end: 'late' }, // half a pair: no times
        { description: 'Admin', quantity: 1, unitPence: 1000, date: 'soon' },
      ],
    })).data;
    expect(inv.lines.map((l: InvoiceLine) => [l.date, l.start, l.end])).toEqual([
      ['2026-09-03', '09:30', '12:30'],
      ['2026-09-04', null, null],
      [null, null, null],
    ]);
    const pdf = await handle(new Request(`${BASE}/api/invoices/${inv.id}/pdf`, { headers: { cookie } }));
    expect(pdf.status).toBe(200);
    const s = (await call('GET', '/api/state')).data.settings;
    expect(s.profile.lateNote).toMatch(/8% a year above the Bank of England base rate.*£40–£100.*Late Payment of Commercial Debts \(Interest\) Act 1998/);
    // Saved with the earlier default wording: it's brought up to date.
    await call('PUT', '/api/settings', { profile: { ...s.profile, lateNote: 'Please pay by the due date. Late payments may be subject to interest and a late-payment charge.' } });
    expect((await call('GET', '/api/state')).data.settings.profile.lateNote).toBe(s.profile.lateNote);
    await call('PUT', '/api/settings', { profile: { ...s.profile, lateNote: 'Overdue invoices are charged 8% a year.' } });
    expect((await call('GET', '/api/state')).data.settings.profile.lateNote).toBe('Overdue invoices are charged 8% a year.');
  });

  it('late fees are per stream: on for business work, off for therapy, and yours to change', async () => {
    await signIn();
    const cst = (await call('POST', '/api/streams', { name: 'Craniosacral therapy' })).data;
    const coffee = (await call('POST', '/api/streams', { name: 'Coffee' })).data;
    expect([cst.lateFees, coffee.lateFees]).toEqual([false, true]);
    expect((await call('POST', '/api/streams', { ...coffee, lateFees: false })).data.lateFees).toBe(false);
    // Saving it again without saying (archiving, renaming) keeps your choice.
    const { lateFees: _, ...rest } = coffee;
    expect((await call('POST', '/api/streams', { ...rest, name: 'Coffee shifts' })).data.lateFees).toBe(false);
    const inv = (await call('POST', '/api/invoices', { clientName: 'X', streamId: cst.id, lines })).data;
    expect((await handle(new Request(`${BASE}/api/invoices/${inv.id}/pdf`, { headers: { cookie } }))).status).toBe(200);
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

describe('Google receipt finder', () => {
  it('takes receipts from the script with its own key, keeps only purchases, skips repeats, and attaches to the bank line', async () => {
    await signIn();
    process.env.ANTHROPIC_API_KEY = 'test-key';
    feed.push(item('g1', 23.99, 'OUT', daysAgo(5), { counterPartyName: 'ADOBE' }));
    await call('POST', '/api/sync', {});
    const day = daysAgo(5).slice(0, 10);

    const { token, since } = (await call('POST', '/api/google/connect', {})).data;
    expect(token).toMatch(/^hny_/);
    expect(since).toMatch(/^\d{4}-04-06$/);
    const script = (path: string, body: unknown, key = token) => {
      const saved = cookie;
      cookie = ''; // the script has no session — only its key
      return call('POST', `/api/google/script/${path}`, body, { Authorization: `Bearer ${key}` }).finally(() => { cookie = saved; });
    };
    expect((await script('unseen', { ids: ['gmail:a'] }, 'hny_wrong')).status).toBe(401);
    expect((await script('unseen', { ids: ['gmail:a', 'gmail:b', 'drive:c'] })).data.unseen).toEqual(['gmail:a', 'gmail:b', 'drive:c']);

    // An Adobe invoice email with a PDF: a purchase, attached to the bank line.
    aiReply = (prompt) => {
      expect(prompt).toContain('Subject: Your Adobe invoice');
      return { kind: 'purchase', merchant: 'Adobe', date: day, total: '23.99', vat: '4.00', currency: 'GBP', category: 'adminCosts', description: 'Creative Cloud monthly' };
    };
    const pdf = { name: 'invoice.pdf', mime: 'application/pdf', dataBase64: Buffer.from('%PDF-1.4 fake').toString('base64') };
    const a = await script('item', { id: 'a', source: 'gmail', from: 'Adobe <mail@adobe.com>', subject: 'Your Adobe invoice', date: day, text: 'Thanks for your payment', file: pdf });
    expect(a.data).toMatchObject({ outcome: 'receipt', matched: true });

    // A newsletter: read, not kept.
    aiReply = () => ({ kind: 'other', merchant: '', date: '', total: '', vat: '', currency: '', category: 'otherExpenses', description: '' });
    expect((await script('item', { id: 'b', source: 'gmail', from: 'x', subject: 'Big sale!', date: day, text: '50% off', file: null })).data.outcome).toBe('other');

    // The same Adobe invoice saved in Drive: recognised as the same purchase.
    aiReply = () => ({ kind: 'purchase', merchant: 'Adobe Systems', date: day, total: '23.99', vat: '', currency: 'GBP', category: 'adminCosts', description: '' });
    expect((await script('item', { id: 'c', source: 'drive', from: '', subject: 'adobe.pdf', date: day, text: 'File', file: pdf })).data.outcome).toBe('duplicate');

    // Nothing is sent twice.
    expect((await script('unseen', { ids: ['gmail:a', 'gmail:b', 'drive:c', 'gmail:d'] })).data.unseen).toEqual(['gmail:d']);

    const s = (await call('GET', '/api/state')).data;
    expect(s.google).toMatchObject({ connected: true, checked: 3, found: 1, matched: 1 });
    const bank = s.transactions.find((t: Transaction) => t.sourceId === 'g1');
    expect(bank.receiptIds).toHaveLength(1);
    expect(bank.bucket).toBe('unreviewed'); // attached, not decided — the AI sort and you do that
    expect(s.receipts[0]).toMatchObject({ merchant: 'Adobe', totalPence: 2399, mime: 'application/pdf' });

    // An email with no attachment is kept as the email itself, served as plain text.
    aiReply = () => ({ kind: 'purchase', merchant: 'Trainline', date: day, total: '41.20', vat: '', currency: 'GBP', category: 'travelCosts', description: 'London return' });
    const e = await script('item', { id: 'd', source: 'gmail', from: 'Trainline', subject: 'Your tickets', date: day, text: 'Total £41.20 <script>x</script>', file: null });
    expect(e.data.outcome).toBe('receipt');
    const file = await call('GET', `/api/receipts/${e.data.receiptId}/file`);
    expect(file.res.headers.get('content-type')).toContain('text/plain');
    expect(file.res.headers.get('x-content-type-options')).toBe('nosniff');

    // Disconnecting locks the script out.
    await call('POST', '/api/google/disconnect', {});
    expect((await script('unseen', { ids: ['gmail:z'] })).status).toBe(401);
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('a signed-in browser can’t pose as the script, and the script can’t reach anything else', async () => {
    await signIn();
    expect((await call('POST', '/api/google/script/unseen', { ids: [] })).status).toBe(401);
    const { token } = (await call('POST', '/api/google/connect', {})).data;
    cookie = '';
    expect((await call('GET', '/api/state', undefined, { Authorization: `Bearer ${token}` })).status).toBe(401);
  });
});

describe('sorting in batches, and undo', () => {
  async function setup() {
    await signIn();
    const stream = (await call('POST', '/api/streams', { name: 'Practice' })).data;
    feed.push(item('c1', 60, 'IN', daysAgo(9), { counterPartyName: 'LARA BLIGH', reference: 'Thanks' }));
    feed.push(item('c2', 60, 'IN', daysAgo(5), { counterPartyName: 'Lara Bligh', reference: 'Session' }));
    feed.push(item('c3', 60, 'IN', daysAgo(2), { counterPartyName: 'LARA BLIGH', reference: 'x' }));
    feed.push(item('t1', 8.4, 'OUT', daysAgo(3), { counterPartyName: 'TFL TRAVEL CH 1234', source: 'MASTER_CARD' }));
    await call('POST', '/api/sync', {});
    const txns: Transaction[] = (await call('GET', '/api/state')).data.transactions;
    const by = (uid: string) => txns.find((t) => t.sourceId === uid)!;
    return { stream, by };
  }

  it('saves a swipe and its similar rows as one batch, with a rule for new ones, and undoes all of it', async () => {
    const { stream, by } = await setup();
    const rows = [by('c1'), by('c2'), by('c3')];
    const patch = { bucket: 'business_income', streamId: stream.id };
    const saved = await call('POST', '/api/transactions/batch', {
      batchId: 'batch-lara-1',
      items: rows.map((t, i) => ({ id: t.id, patch, expectUpdatedAt: t.updatedAt, unlessYours: i > 0 })),
      rule: { field: 'counterparty', pattern: 'lara bligh', direction: 'in', bucket: 'business_income', streamId: stream.id },
    });
    expect(saved.status).toBe(200);
    expect(saved.data.updated).toHaveLength(3);
    expect(saved.data.updated.every((t: Transaction) => t.bucket === 'business_income' && t.classifiedBy === 'user' && t.streamId === stream.id)).toBe(true);
    expect(saved.data.rule).toMatchObject({ pattern: 'lara bligh', bucket: 'business_income' });

    // A hand edit afterwards makes that row yours; undo leaves it alone.
    await call('PATCH', `/api/transactions/${by('c3').id}`, { note: 'paid for two' });
    await call('PATCH', `/api/transactions/${by('c3').id}`, { bucket: 'personal' });

    const undo = await call('POST', '/api/batches/batch-lara-1/undo', {});
    expect(undo.data).toEqual({ undone: 2, kept: 1, ruleRemoved: true });
    const after: Transaction[] = (await call('GET', '/api/state')).data.transactions;
    const now = (uid: string) => after.find((t) => t.sourceId === uid)!;
    expect(now('c1')).toMatchObject({ bucket: 'unreviewed', streamId: null, classifiedBy: null });
    expect(now('c2')).toMatchObject({ bucket: 'unreviewed', classifiedBy: null });
    expect(now('c3').bucket).toBe('personal');
    expect((await call('GET', '/api/state')).data.rules).toHaveLength(0);
    // Undo is once only.
    expect((await call('POST', '/api/batches/batch-lara-1/undo', {})).status).toBe(409);
    expect((await call('POST', '/api/batches/no-such-batch/undo', {})).status).toBe(404);
  });

  it('a newer rule for the same payee replaces the old one, and undo brings the old one back', async () => {
    const { stream, by } = await setup();
    const rule = { field: 'counterparty', pattern: 'lara bligh', direction: 'in' };
    await call('POST', '/api/transactions/batch', { batchId: 'batch-r-1', items: [{ id: by('c1').id, patch: { bucket: 'personal' } }], rule: { ...rule, bucket: 'personal' } });
    await call('POST', '/api/transactions/batch', {
      batchId: 'batch-r-2',
      items: [{ id: by('c2').id, patch: { bucket: 'business_income', streamId: stream.id } }],
      rule: { ...rule, pattern: 'LARA BLIGH', bucket: 'business_income', streamId: stream.id },
    });
    let rules = (await call('GET', '/api/state')).data.rules;
    expect(rules.map((x: { bucket: string }) => x.bucket)).toEqual(['business_income']);
    await call('POST', '/api/batches/batch-r-2/undo', {});
    rules = (await call('GET', '/api/state')).data.rules;
    expect(rules.map((x: { bucket: string }) => x.bucket)).toEqual(['personal']);
  });

  it('never overwrites a row changed since, or one you had already sorted yourself', async () => {
    const { stream, by } = await setup();
    const c1 = by('c1');
    await call('PATCH', `/api/transactions/${by('c2').id}`, { bucket: 'personal' }); // yours
    const res = await call('POST', '/api/transactions/batch', {
      batchId: 'batch-guard-1',
      items: [
        { id: c1.id, patch: { bucket: 'business_income', streamId: stream.id }, expectUpdatedAt: '2000-01-01T00:00:00.000Z' },
        { id: by('c2').id, patch: { bucket: 'business_income', streamId: stream.id }, unlessYours: true },
        { id: 'nope', patch: { bucket: 'personal' } },
      ],
    });
    expect(res.data.updated).toHaveLength(0);
    expect(res.data.skipped.map((x: { reason: string }) => x.reason)).toEqual(['changed since', 'yours', 'not found']);
  });

  it('a swipe that settles an invoice marks it paid, and undo puts it back to waiting', async () => {
    const { stream, by } = await setup();
    const inv = (await call('POST', '/api/invoices', { clientName: 'Lara Bligh', streamId: stream.id, lines: [{ description: 'Session', quantity: 1, unitPence: 6500 }] })).data;
    await call('PATCH', `/api/invoices/${inv.id}`, { status: 'sent' });
    const c1 = by('c1'); // £60 in on a £65 invoice
    const saved = await call('POST', '/api/transactions/batch', {
      batchId: 'batch-inv-1',
      items: [{ id: c1.id, patch: { bucket: 'business_income', streamId: stream.id }, payInvoiceId: inv.id }],
    });
    expect(saved.data.invoicesPaid).toBe(1);
    expect(saved.data.updated[0]).toMatchObject({ bucket: 'business_income', meta: { invoiceId: inv.id } });
    let state = (await call('GET', '/api/state')).data;
    expect(state.invoices[0].paidTransactionId).toBe(c1.id);

    expect((await call('POST', '/api/batches/batch-inv-1/undo', {})).data.undone).toBe(1);
    state = (await call('GET', '/api/state')).data;
    expect(state.invoices[0].paidTransactionId).toBeNull();
    const back = state.transactions.find((t: Transaction) => t.id === c1.id);
    expect(back).toMatchObject({ bucket: 'unreviewed', classifiedBy: null, note: '' });
    expect(back.meta.invoiceId || '').toBe('');
  });

  it('a swipe never pays an invoice with money going out, or one already paid', async () => {
    const { stream, by } = await setup();
    const inv = (await call('POST', '/api/invoices', { clientName: 'X', lines: [{ description: 'S', quantity: 1, unitPence: 6000 }] })).data;
    await call('PATCH', `/api/invoices/${inv.id}`, { status: 'sent' });
    const out = await call('POST', '/api/transactions/batch', {
      batchId: 'batch-inv-2', items: [{ id: by('t1').id, patch: { bucket: 'business_expense', streamId: stream.id, category: 'carVanTravelExpenses' }, payInvoiceId: inv.id }],
    });
    expect(out.data.invoicesPaid).toBe(0);
    await call('POST', '/api/transactions/batch', { batchId: 'batch-inv-3', items: [{ id: by('c1').id, patch: { bucket: 'business_income' }, payInvoiceId: inv.id }] });
    const again = await call('POST', '/api/transactions/batch', { batchId: 'batch-inv-4', items: [{ id: by('c2').id, patch: { bucket: 'business_income' }, payInvoiceId: inv.id }] });
    expect(again.data.invoicesPaid).toBe(0);
    expect((await call('GET', '/api/state')).data.invoices[0].paidTransactionId).toBe(by('c1').id);
  });

  it('checks every row before writing any', async () => {
    const { by } = await setup();
    const res = await call('POST', '/api/transactions/batch', {
      batchId: 'batch-bad-1',
      items: [{ id: by('c1').id, patch: { bucket: 'personal' } }, { id: by('c2').id, patch: { bucket: 'free money' } }],
    });
    expect(res.status).toBe(400);
    const after: Transaction[] = (await call('GET', '/api/state')).data.transactions;
    expect(after.find((t) => t.sourceId === 'c1')!.bucket).toBe('unreviewed');
    expect((await call('POST', '/api/transactions/batch', { batchId: 'x', items: [] })).status).toBe(400);
  });

  it('putting a row back to sort makes it no one’s again', async () => {
    const { by } = await setup();
    const t = by('t1');
    await call('PATCH', `/api/transactions/${t.id}`, { bucket: 'personal' });
    const back = await call('PATCH', `/api/transactions/${t.id}`, { bucket: 'unreviewed' });
    expect(back.data).toMatchObject({ bucket: 'unreviewed', classifiedBy: null });
  });

  it('receipts can be moved aside and back, one or many, without deleting them', async () => {
    await signIn();
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360000000000200010be203a50000000049454e44ae426082', 'hex').toString('base64');
    const a = (await call('POST', '/api/receipts', { filename: 'a.png', mime: 'image/png', dataBase64: png })).data.receipt;
    const b = (await call('POST', '/api/receipts', { filename: 'b.png', mime: 'image/png', dataBase64: png })).data.receipt;
    expect(a.notNeeded).toBe(false);
    expect((await call('POST', '/api/receipts/aside', { ids: [a.id, b.id, 'gone'], notNeeded: true })).data.changed).toBe(2);
    let receipts = (await call('GET', '/api/state')).data.receipts;
    expect(receipts.map((x: { notNeeded: boolean }) => x.notNeeded)).toEqual([true, true]);
    expect((await call('PATCH', `/api/receipts/${a.id}`, { notNeeded: false })).data.notNeeded).toBe(false);
    receipts = (await call('GET', '/api/state')).data.receipts;
    expect(receipts).toHaveLength(2);
    expect((await call('DELETE', `/api/receipts/${a.id}`)).status).toBe(200);
    expect((await call('GET', '/api/state')).data.receipts).toHaveLength(1);
  });

  it('a receipt matched to a row gives it the only stream there is', async () => {
    const { stream, by } = await setup();
    const t = by('t1');
    // The sync made a CSTL stream too; archive it so Practice is the only one in use.
    for (const st of (await call('GET', '/api/state')).data.streams) {
      if (st.id !== stream.id) await call('POST', '/api/streams', { ...st, archived: true });
    }
    process.env.ANTHROPIC_API_KEY = 'test-key';
    aiReply = () => ({ merchant: 'TfL', date: t.date, totalPence: 840, vatPence: null, category: 'carVanTravelExpenses', description: 'Oyster fare', isReceipt: true });
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360000000000200010be203a50000000049454e44ae426082', 'hex').toString('base64');
    await call('POST', '/api/receipts', { filename: 'tfl.png', mime: 'image/png', dataBase64: png, transactionId: t.id });
    const after = (await call('GET', '/api/state')).data.transactions.find((x: Transaction) => x.id === t.id);
    expect(after).toMatchObject({ bucket: 'business_expense', streamId: stream.id, category: 'carVanTravelExpenses' });
  });
});

describe('starting fresh from your own spreadsheet', () => {
  /** A record from the old app, as its import left it (the import itself is gone). */
  async function oldAppRecord(sourceId: string, date: string, amountPence: number, counterparty: string) {
    const at = new Date().toISOString();
    await repo(db).insertMany([{
      id: `old-${sourceId}`, date, amountPence, direction: 'in', source: 'import', sourceId, counterparty, reference: '', bucket: 'business_income',
      streamId: null, category: null, businessPercent: 100, note: '', classifiedBy: 'import', meta: {}, receiptIds: [], createdAt: at, updatedAt: at,
    }]);
  }

  async function download(prefill = true): Promise<Buffer> {
    const res = await handle(new Request(`${BASE}/api/fresh/template.xlsx${prefill ? '' : '?prefill=0'}`, { headers: { cookie } }));
    expect(res.headers.get('content-type')).toContain('spreadsheetml');
    return Buffer.from(await res.arrayBuffer());
  }

  it('gives you the spreadsheet: your bank lines in, the old app left out, dropdowns and instructions', async () => {
    await signIn();
    await call('POST', '/api/streams', { name: 'Coffee' });
    feed.push(item('fs-1', 45.5, 'OUT', daysAgo(20), { counterPartyName: 'SHELL 334', source: 'MASTER_CARD' }));
    await call('POST', '/api/sync', {});
    await oldAppRecord('honeypot:entry:fs', daysAgo(40).slice(0, 10), 999, 'Old thing');
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await download()) as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['How to fill it in', 'Payments', 'Lists']);
    const ws = wb.getWorksheet('Payments')!;
    expect(ws.getRow(1).values).toEqual([undefined, 'Date', 'In/Out', 'Amount £', 'Who', 'Reference', 'What is it?', 'Stream', 'Category', 'Work %', 'Note', 'Account']);
    expect(ws.actualRowCount).toBe(2); // the Shell line; not the old app's record
    expect(ws.getRow(2).getCell(4).value).toBe('SHELL 334');
    expect(ws.getRow(2).getCell(6).value).toBe('Not sure yet');
    expect(wb.getWorksheet('Lists')!.getColumn(3).values).toContain('Coffee');
    const blank = new ExcelJS.Workbook();
    await blank.xlsx.load((await download(false)) as unknown as ExcelJS.Buffer);
    expect(blank.getWorksheet('Payments')!.actualRowCount).toBe(1);
  });

  it('reads it back, shows what it would do, replaces — and the bank feed only fills in after it; undo puts everything back', async () => {
    await signIn();
    const stream = (await call('POST', '/api/streams', { name: 'Coffee' })).data;
    feed.push(item('fs-a', 45.5, 'OUT', daysAgo(20), { counterPartyName: 'SHELL 334', source: 'MASTER_CARD' }));
    feed.push(item('fs-b', 162, 'IN', daysAgo(15), { counterPartyName: 'ETHICAL CAFF', source: 'FASTER_PAYMENTS_IN' }));
    await call('POST', '/api/sync', {});
    await oldAppRecord('honeypot:entry:dup', daysAgo(14).slice(0, 10), 9900, 'Caff');
    const before: Transaction[] = (await call('GET', '/api/state')).data.transactions;

    // Fill it in on the laptop: sort both lines, add a cash payment.
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await download()) as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet('Payments')!;
    const rowFor = (who: string) => [2, 3].map((i) => ws.getRow(i)).find((r) => r.getCell(4).value === who)!;
    rowFor('SHELL 334').getCell(6).value = 'Business cost';
    rowFor('SHELL 334').getCell(7).value = 'Coffee';
    rowFor('SHELL 334').getCell(8).value = 'Car, van & travel';
    rowFor('SHELL 334').getCell(10).value = 'Fuel to shifts';
    rowFor('ETHICAL CAFF').getCell(6).value = 'Business income';
    rowFor('ETHICAL CAFF').getCell(7).value = 'Coffee';
    const cashDate = new Date(Date.now() - 12 * 86_400_000);
    ws.addRow([new Date(Date.UTC(cashDate.getUTCFullYear(), cashDate.getUTCMonth(), cashDate.getUTCDate())), 'In', 60, 'Cash client', '', 'Business income', 'Media work', '', null, '', 'Cash']);
    const dataBase64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');

    const preview = (await call('POST', '/api/fresh/preview', { dataBase64 })).data;
    expect(preview.read.problems).toEqual([]);
    expect(preview.plan).toMatchObject({ count: 3, newStreams: ['Media work'] });
    expect(preview.plan.removing).toMatchObject({ bank: 2, oldApp: 1 });
    expect((await call('GET', '/api/state')).data.transactions).toHaveLength(before.length); // a preview changes nothing

    expect((await call('POST', '/api/fresh/apply', { dataBase64, cutoff: '2000-01-01' })).status).toBe(409);
    const done = (await call('POST', '/api/fresh/apply', { dataBase64, cutoff: preview.plan.cutoff })).data;
    expect(done).toMatchObject({ inserted: 3, removed: 3, cutoff: preview.plan.cutoff, streamsMade: ['Media work'] });
    let state = (await call('GET', '/api/state')).data;
    expect(state.fresh).toMatchObject({ cutoff: preview.plan.cutoff, canUndo: true });
    expect(state.transactions.map((t: Transaction) => t.source)).toEqual(['sheet', 'sheet', 'sheet']);
    const shell = state.transactions.find((t: Transaction) => t.counterparty === 'SHELL 334');
    expect(shell).toMatchObject({ bucket: 'business_expense', category: 'carVanTravelExpenses', streamId: stream.id, note: 'Fuel to shifts', classifiedBy: 'user' });

    // The feed reads its whole window again: what's in the sheet isn't added twice; what's newer is.
    feed.push(item('fs-c', 12, 'OUT', daysAgo(1), { counterPartyName: 'BOOTS', source: 'MASTER_CARD' }));
    await call('POST', '/api/sync', {});
    state = (await call('GET', '/api/state')).data;
    expect(state.transactions.map((t: Transaction) => t.sourceId).filter((x: string) => x?.startsWith('fs-'))).toEqual(['fs-c']);
    expect(state.transactions.some((t: Transaction) => t.source === 'import')).toBe(false);

    const undone = (await call('POST', '/api/fresh/undo', {})).data;
    expect(undone).toEqual({ restored: 3, removed: 3 });
    state = (await call('GET', '/api/state')).data;
    expect(state.fresh).toBeNull();
    expect(state.transactions.map((t: Transaction) => t.id).sort()).toEqual([...before.map((t) => t.id), state.transactions.find((t: Transaction) => t.sourceId === 'fs-c').id].sort());
  });

  it('moves receipts and paid invoices onto the sheet’s lines — they add nothing; a payment left out leaves its invoice owed', async () => {
    await signIn();
    const stream = (await call('POST', '/api/streams', { name: 'Coffee' })).data;
    feed.push(item('fc-pay', 162, 'IN', daysAgo(15), { counterPartyName: 'ETHICAL CAFF', reference: 'SHIFTS', source: 'FASTER_PAYMENTS_IN' }));
    feed.push(item('fc-gone', 80, 'IN', daysAgo(18), { counterPartyName: 'SOMEONE', source: 'FASTER_PAYMENTS_IN' }));
    feed.push(item('fc-phone', 12, 'OUT', daysAgo(20), { counterPartyName: 'LEBARA', source: 'MASTER_CARD' }));
    await call('POST', '/api/sync', {});
    let state = (await call('GET', '/api/state')).data;
    const bank = (uid: string) => state.transactions.find((t: Transaction) => t.sourceId === uid);
    const [caffRow, goneRow, phoneRow] = [bank('fc-pay'), bank('fc-gone'), bank('fc-phone')];
    const a = (await call('POST', '/api/invoices', { clientName: 'Ethical Caff', streamId: stream.id, lines: [{ description: 'Shifts', quantity: 1, unitPence: 16200 }] })).data;
    const b = (await call('POST', '/api/invoices', { clientName: 'Someone', lines: [{ description: 'Odd job', quantity: 1, unitPence: 8000 }] })).data;
    for (const [inv, row] of [[a, caffRow], [b, goneRow]]) {
      await call('PATCH', `/api/invoices/${inv.id}`, { status: 'sent' });
      await call('POST', `/api/invoices/${inv.id}/pay`, { transactionId: row.id });
    }
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const rc = (await call('POST', '/api/receipts', { filename: 'lebara.png', mime: 'image/png', dataBase64: png })).data.receipt;
    await call('PATCH', `/api/receipts/${rc.id}`, { totalPence: 1200, date: phoneRow.date });
    await call('POST', '/api/sync', {});
    expect((await call('GET', '/api/state')).data.receipts[0].transactionId).toBe(phoneRow.id);

    // The sheet: the two kept lines sorted, the £80 left out.
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await download()) as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet('Payments')!;
    const rowOf = (who: string) => [2, 3, 4].find((i) => ws.getRow(i).getCell(4).value === who)!;
    ws.getRow(rowOf('LEBARA')).getCell(6).value = 'Business cost';
    ws.getRow(rowOf('LEBARA')).getCell(8).value = 'Phone, stationery & office';
    ws.spliceRows(rowOf('SOMEONE'), 1);
    const dataBase64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const preview = (await call('POST', '/api/fresh/preview', { dataBase64 })).data;
    const done = (await call('POST', '/api/fresh/apply', { dataBase64, cutoff: preview.plan.cutoff })).data;
    expect(done).toMatchObject({ inserted: 2, removed: 3, invoices: 1, receipts: 1, invoicesLeftOpen: [b.number] });

    state = (await call('GET', '/api/state')).data;
    expect(state.transactions).toHaveLength(2); // nothing added for the receipt or the invoices
    const caff = state.transactions.find((t: Transaction) => t.counterparty === 'ETHICAL CAFF');
    const phone = state.transactions.find((t: Transaction) => t.counterparty === 'LEBARA');
    expect(state.invoices.find((i: any) => i.id === a.id).paidTransactionId).toBe(caff.id);
    expect(caff).toMatchObject({ source: 'sheet', bucket: 'business_income', classifiedBy: 'user', meta: { invoiceId: a.id } });
    expect(state.invoices.find((i: any) => i.id === b.id).paidTransactionId).toBeNull();
    expect(state.receipts[0].transactionId).toBe(phone.id);
    expect(phone).toMatchObject({ bucket: 'business_expense', category: 'adminCosts', receiptIds: [rc.id] });

    // Once only: unpaying the invoice by hand isn't redone by the next sync.
    await call('POST', `/api/invoices/${a.id}/unpay`, {});
    await call('POST', '/api/sync', {});
    expect((await call('GET', '/api/state')).data.invoices.find((i: any) => i.id === a.id).paidTransactionId).toBeNull();

    await call('POST', '/api/fresh/undo', {});
    state = (await call('GET', '/api/state')).data;
    expect(state.invoices.find((i: any) => i.id === a.id).paidTransactionId).toBe(caffRow.id);
    expect(state.invoices.find((i: any) => i.id === b.id).paidTransactionId).toBe(goneRow.id);
    expect(state.receipts[0].transactionId).toBe(phoneRow.id);
  });

  it('says what it can’t read, and refuses a file that isn’t a spreadsheet', async () => {
    await signIn();
    const csv = 'Date,Amount,What is it?\n2025-10-01,60,Business income\nsometime,5,Personal\n';
    const preview = (await call('POST', '/api/fresh/preview', { dataBase64: Buffer.from(csv).toString('base64') })).data;
    expect(preview.plan.count).toBe(1);
    expect(preview.read.problems[0]).toMatchObject({ line: 3, skipped: true });
    const notXlsx = Buffer.concat([Buffer.from('PK'), Buffer.from('not really a zip')]).toString('base64');
    const bad = await call('POST', '/api/fresh/preview', { dataBase64: notXlsx });
    expect(bad.status).toBe(400);
    expect(bad.data.error).toMatch(/Excel/);
  });
});

describe('bank transfers', () => {
  it('sorts transfers you send and your own money moving; leaves client payments; rules come first', async () => {
    await signIn();
    const s = (await call('GET', '/api/state')).data.settings;
    await call('PUT', '/api/settings', { profile: { ...s.profile, name: 'Phoenix Tanner' } });
    const stream = (await call('POST', '/api/streams', { name: 'Practice' })).data;
    await call('POST', '/api/rules', { field: 'counterparty', pattern: 'studio hire', direction: 'out', bucket: 'business_expense', streamId: stream.id, category: 'premisesRunningCosts' });
    feed.push(item('tr-rent', 500, 'OUT', daysAgo(3), { counterPartyName: 'LANDLORD', source: 'FASTER_PAYMENTS_OUT' }));
    feed.push(item('tr-own', 200, 'IN', daysAgo(3), { counterPartyName: 'PHOENIX TANNER', source: 'FASTER_PAYMENTS_IN' }));
    feed.push(item('tr-client', 60, 'IN', daysAgo(3), { counterPartyName: 'LARA BLIGH', source: 'FASTER_PAYMENTS_IN' }));
    feed.push(item('tr-studio', 40, 'OUT', daysAgo(3), { counterPartyName: 'STUDIO HIRE LTD', source: 'FASTER_PAYMENTS_OUT' }));
    await call('POST', '/api/sync', {});
    const rows: Transaction[] = (await call('GET', '/api/state')).data.transactions;
    const by = (uid: string) => rows.find((t) => t.sourceId === uid)!;
    expect(by('tr-rent')).toMatchObject({ bucket: 'personal', classifiedBy: 'rule', meta: { autoSorted: 'transfer' } });
    expect(by('tr-own').bucket).toBe('transfer');
    expect(by('tr-client').bucket).toBe('unreviewed');
    expect(by('tr-studio')).toMatchObject({ bucket: 'business_expense', category: 'premisesRunningCosts' });
  });

  it('a rule for a standing order that is a business cost (studio rent) re-sorts the ones the setting took as personal', async () => {
    await signIn();
    const stream = (await call('POST', '/api/streams', { name: 'Craniosacral therapy' })).data;
    feed.push(item('amy-1', 350, 'OUT', daysAgo(40), { counterPartyName: 'AMY ROSE', reference: 'STUDIO RENT', source: 'STANDING_ORDER' }));
    feed.push(item('amy-2', 350, 'OUT', daysAgo(10), { counterPartyName: 'AMY ROSE', reference: 'STUDIO RENT', source: 'STANDING_ORDER' }));
    feed.push(item('amy-3', 20, 'OUT', daysAgo(9), { counterPartyName: 'AMY ROSE', reference: 'Drinks', source: 'FASTER_PAYMENTS_OUT' }));
    await call('POST', '/api/sync', {});
    let rows: Transaction[] = (await call('GET', '/api/state')).data.transactions;
    expect(rows.filter((t) => t.counterparty === 'AMY ROSE').map((t) => t.bucket)).toEqual(['personal', 'personal', 'personal']);
    // You decide the drinks yourself; then make a rule for the rent.
    const drinks = rows.find((t) => t.sourceId === 'amy-3')!;
    await call('PATCH', `/api/transactions/${drinks.id}`, { bucket: 'personal' });
    const made = await call('POST', '/api/rules', { field: 'reference', pattern: 'studio rent', direction: 'out', bucket: 'business_expense', streamId: stream.id, category: 'premisesRunningCosts' });
    expect(made.data.applied).toBe(2);
    rows = (await call('GET', '/api/state')).data.transactions;
    const by = (uid: string) => rows.find((t) => t.sourceId === uid)!;
    expect(by('amy-1')).toMatchObject({ bucket: 'business_expense', category: 'premisesRunningCosts', streamId: stream.id, meta: { autoSorted: '' } });
    expect(by('amy-2').bucket).toBe('business_expense');
    expect(by('amy-3')).toMatchObject({ bucket: 'personal', classifiedBy: 'user' });
    // And next month's arrives sorted.
    feed.push(item('amy-4', 350, 'OUT', daysAgo(1), { counterPartyName: 'AMY ROSE', reference: 'STUDIO RENT', source: 'STANDING_ORDER' }));
    await call('POST', '/api/sync', {});
    const next = (await call('GET', '/api/state')).data.transactions.find((t: Transaction) => t.sourceId === 'amy-4');
    expect(next).toMatchObject({ bucket: 'business_expense', category: 'premisesRunningCosts' });
  });

  it('switched off, leaves them to you', async () => {
    await signIn();
    await call('PUT', '/api/settings', { transfersPersonal: false });
    feed.push(item('tr-off', 25, 'OUT', daysAgo(2), { counterPartyName: 'A FRIEND', source: 'FASTER_PAYMENTS_OUT' }));
    await call('POST', '/api/sync', {});
    const t = (await call('GET', '/api/state')).data.transactions.find((x: Transaction) => x.sourceId === 'tr-off');
    expect(t).toMatchObject({ bucket: 'unreviewed', classifiedBy: null });
  });
});

describe('the same money counted twice', () => {
  it('finds a payment brought in twice (live feed + statement file), merges it, and the statement can’t bring it back', async () => {
    await signIn();
    feed.push(item('live-1', 60, 'IN', daysAgo(5), { counterPartyName: 'LARA BLIGH' }));
    await call('POST', '/api/sync', {});
    const liveDate = (await call('GET', '/api/state')).data.transactions[0].date;
    const lines = [{ sourceId: 'stmt-1', date: liveDate, amountPence: 6000, direction: 'in', counterparty: 'Lara Bligh', reference: '', ownMove: false, bankType: 'Faster payment', bankCategory: '' }];
    // Merged on arrival: same day, same amount, same name, nothing else it could be.
    expect((await call('POST', '/api/import/bank', { importId: 'stmt-import-1', account: 'Starling CSV', kind: 'bankcsv', lines })).data).toMatchObject({ added: 1, doublesMerged: 1 });
    let state = (await call('GET', '/api/state')).data;
    expect(state.transactions.map((t: Transaction) => t.source)).toEqual(['starling']);
    expect((await call('POST', '/api/import/bank', { importId: 'stmt-import-2', account: 'Starling CSV', kind: 'bankcsv', lines })).data).toMatchObject({ added: 0, already: 1 });
    state = (await call('GET', '/api/state')).data;
    expect(state.transactions).toHaveLength(1);
  });
});

describe('what you tell the AI about yourself', () => {
  it('is saved, read before every receipt, and a receipt’s stream and reason carry onto its bank line', async () => {
    await signIn();
    const cst = (await call('POST', '/api/streams', { name: 'Craniosacral therapy', about: 'Home visits to private clients' })).data;
    await call('POST', '/api/streams', { name: 'Coffee' });
    const aboutMe = 'Most payments on my Starling card are for my work. Petrol is for driving to clients.';
    expect((await call('PUT', '/api/settings', { aboutMe })).data.aboutMe).toBe(aboutMe);
    const t = (await call('POST', '/api/transactions', { date: thisYear(), amountPence: 4550, direction: 'out', counterparty: 'SHELL 334', bucket: 'unreviewed' })).data;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    let sent = '';
    aiReply = (prompt) => {
      sent = prompt;
      return { merchant: 'Shell', date: thisYear(), total: '45.50', vat: '7.58', currency: 'GBP', category: 'carVanTravelExpenses', description: 'Fuel', why: 'Fuel driving to clients’ homes', streamId: cst.id };
    };
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360000000000200010be203a50000000049454e44ae426082', 'hex').toString('base64');
    const up = (await call('POST', '/api/receipts', { filename: 'shell.png', mime: 'image/png', dataBase64: png, transactionId: t.id })).data;
    expect(sent).toContain('Most payments on my Starling card are for my work');
    expect(sent).toContain('Home visits to private clients');
    expect(up.receipt).toMatchObject({ suggestedStreamId: cst.id, why: 'Fuel driving to clients’ homes' });
    const after = (await call('GET', '/api/state')).data.transactions.find((x: Transaction) => x.id === t.id);
    expect(after).toMatchObject({ bucket: 'business_expense', streamId: cst.id, category: 'carVanTravelExpenses', note: 'Fuel driving to clients’ homes' });
  });
});

describe('other banks and spreadsheets', () => {
  const lines = [
    { sourceId: 'tx_1', date: thisYear(), amountPence: 2000, direction: 'out', counterparty: 'WHR Consulting Ltd', reference: '', ownMove: false, bankType: 'Faster payment', bankCategory: 'Bills' },
    { sourceId: 'tx_2', date: thisYear(), amountPence: 20000, direction: 'out', counterparty: 'Studio Rent', reference: '', ownMove: true, bankType: 'Pot transfer', bankCategory: '' },
    { sourceId: 'tx_3', date: thisYear(), amountPence: 6000, direction: 'in', counterparty: 'Lara Bligh', reference: 'Thanks', ownMove: false, bankType: 'Faster payment', bankCategory: '' },
  ];

  it('brings in a Monzo statement once, through your rules, with pots as transfers — and can take it back', async () => {
    await signIn();
    const stream = (await call('POST', '/api/streams', { name: 'Practice' })).data;
    await call('POST', '/api/rules', { field: 'counterparty', pattern: 'whr consulting', direction: 'out', bucket: 'business_expense', streamId: stream.id, category: 'premisesRunningCosts' });
    const first = await call('POST', '/api/import/bank', { importId: 'import-monzo-1', account: 'Monzo', kind: 'monzo', lines });
    expect(first.data).toEqual({ added: 3, sortedByRules: 1, potMoves: 1, transfersSorted: 0, already: 0, unreadable: 0, beforeYourSheet: 0, doublesMerged: 0 });
    const again = await call('POST', '/api/import/bank', { importId: 'import-monzo-2', account: 'Monzo', kind: 'monzo', lines });
    expect(again.data).toMatchObject({ added: 0, already: 3 });

    let txns: Transaction[] = (await call('GET', '/api/state')).data.transactions;
    const by = (sid: string) => txns.find((t) => t.sourceId === sid)!;
    expect(by('tx_1')).toMatchObject({ source: 'monzo', bucket: 'business_expense', category: 'premisesRunningCosts', classifiedBy: 'rule' });
    expect(by('tx_2')).toMatchObject({ bucket: 'transfer' });
    expect(by('tx_3').meta).toMatchObject({ account: 'Monzo', importId: 'import-monzo-1' });
    // A bank line can't be deleted by hand…
    expect((await call('DELETE', `/api/transactions/${by('tx_3').id}`)).status).toBe(400);
    // …but a wrong import can be taken back, keeping anything you've sorted since.
    await call('PATCH', `/api/transactions/${by('tx_3').id}`, { bucket: 'business_income', streamId: stream.id });
    const undo = await call('POST', '/api/imports/import-monzo-1/undo', {});
    expect(undo.data).toEqual({ removed: 2, kept: 1 });
    txns = (await call('GET', '/api/state')).data.transactions;
    expect(txns.map((t) => t.sourceId)).toEqual(['tx_3']);
  });

  it('refuses nonsense lines and a missing import id', async () => {
    await signIn();
    expect((await call('POST', '/api/import/bank', { account: 'Monzo', lines })).status).toBe(400);
    const r = await call('POST', '/api/import/bank', { importId: 'import-bad-1', kind: 'bank', account: 'Barclays', lines: [{ sourceId: 'x', date: 'soon', amountPence: 5 }, { sourceId: 'y', date: thisYear(), amountPence: -5 }] });
    expect(r.data).toMatchObject({ added: 0, unreadable: 2 });
  });

  it('downloads a file to edit with an ID on every row', async () => {
    await signIn();
    await call('POST', '/api/import/bank', { importId: 'import-monzo-3', account: 'Monzo', kind: 'monzo', lines });
    const r = await call('GET', '/api/export-edit.csv?year=all');
    expect(r.res.headers.get('content-disposition')).toContain('honey-all-to-edit.csv');
    const body = String(r.data).replace(/^﻿/, '').trim().split('\r\n');
    expect(body[0]).toMatch(/^Honey ID/);
    expect(body).toHaveLength(4);
    expect(body.slice(1).every((l) => l.startsWith('h-'))).toBe(true);
  });
});

describe('workbook to check before the accountant', () => {
  it('has every line of the year, Honey’s figures beside formulas, and a Transactions sheet that comes back as-is', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const { parseCsv } = await import('../../src/core/csv');
    const { planEditImport } = await import('../../src/core/csvRoundTrip');
    await signIn();
    const stream = (await call('POST', '/api/streams', { name: 'Practice' })).data;
    feed.push(item('w1', 60, 'IN', daysAgo(4), { counterPartyName: 'Lara Bligh' }));
    feed.push(item('w2', 20, 'OUT', daysAgo(3), { counterPartyName: 'WHR Consulting', source: 'FASTER_PAYMENTS_OUT' }));
    feed.push(item('w3', 14.88, 'OUT', daysAgo(2), { counterPartyName: 'TESCO', source: 'MASTER_CARD' }));
    await call('POST', '/api/sync', {});
    const state = (await call('GET', '/api/state')).data;
    const by = (uid: string) => state.transactions.find((t: Transaction) => t.sourceId === uid)!;
    await call('PATCH', `/api/transactions/${by('w1').id}`, { bucket: 'business_income', streamId: stream.id });
    await call('PATCH', `/api/transactions/${by('w2').id}`, { bucket: 'business_expense', streamId: stream.id, category: 'premisesRunningCosts' });

    const { taxYearOf } = await import('../../src/core/dates');
    const fresh = (await call('GET', '/api/state')).data;
    const year = taxYearOf(by('w3').date);
    // The three lines only share a tax year if none crosses 6 April; skip the year check if one does.
    const sameYear = ['w1', 'w2', 'w3'].every((u) => taxYearOf(by(u).date) === year);
    const res = await handle(new Request(`${BASE}/api/export.xlsx?year=${year}`, { headers: { cookie } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Transactions', 'Lists']);
    const tx = wb.getWorksheet('Transactions')!;
    if (sameYear) expect(tx.rowCount).toBe(4);
    const summary = wb.getWorksheet('Summary')!;
    const cells: { label: string; honey: unknown; sheet: unknown }[] = [];
    summary.eachRow((r) => cells.push({ label: String(r.getCell(1).value ?? ''), honey: r.getCell(3).value, sheet: r.getCell(4).value }));
    if (sameYear) {
      const turnover = cells.find((c) => c.label.startsWith('Turnover'))!;
      expect(turnover.honey).toBe(60);
      expect((turnover.sheet as { formula: string; result: number }).result).toBe(60);
      expect((turnover.sheet as { formula: string }).formula).toContain('SUMIFS(Transactions!$P$2:$P$4');
      expect(cells.find((c) => c.label.startsWith('Net profit'))!.honey).toBe(40);
    }

    // Saved as CSV, the Transactions sheet reads back into Honey with nothing changed.
    const csv = (await wb.csv.writeBuffer({ sheetName: 'Transactions' })).toString();
    const plan = planEditImport(parseCsv(csv), fresh.transactions, fresh.streams);
    expect(plan).toMatchObject({ problems: [], conflicts: [], changes: [] });
    expect(plan.unchanged).toBe(tx.rowCount - 1);
  });
});

describe('receipts found while sorting', () => {
  it('attaches a found receipt with the swipe, and undo takes it off again', async () => {
    await signIn();
    const stream = (await call('POST', '/api/streams', { name: 'Practice' })).data;
    feed.push(item('fb1', 12, 'OUT', daysAgo(3), { counterPartyName: 'FACEBK *ADS', source: 'MASTER_CARD' }));
    await call('POST', '/api/sync', {});
    const t = (await call('GET', '/api/state')).data.transactions[0] as Transaction;
    // A receipt the app has but couldn't match automatically (no date read off it).
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360000000000200010be203a50000000049454e44ae426082', 'hex').toString('base64');
    const up = (await call('POST', '/api/receipts', { filename: 'meta.png', mime: 'image/png', dataBase64: png })).data;
    expect(up.matchedTransactionId).toBeNull();
    const res = await call('POST', '/api/transactions/batch', {
      batchId: 'batch-rc-1',
      items: [{ id: t.id, patch: { bucket: 'business_expense', streamId: stream.id, category: 'advertisingCosts' }, attachReceiptIds: [up.receipt.id, 'nope'] }],
    });
    expect(res.data.receiptsAttached).toBe(1);
    expect(res.data.updated[0].receiptIds).toEqual([up.receipt.id]);
    let receipts = (await call('GET', '/api/state')).data.receipts;
    expect(receipts[0].transactionId).toBe(t.id);
    await call('POST', '/api/batches/batch-rc-1/undo', {});
    receipts = (await call('GET', '/api/state')).data.receipts;
    expect(receipts[0].transactionId).toBeNull();
  });
});

describe('calendar link', () => {
  it('is saved from settings, refused if it isn’t a link, and reports a missing one clearly', async () => {
    await signIn();
    expect((await call('GET', '/api/calendar/events?from=2026-09-01&to=2026-09-30')).status).toBe(400);
    expect((await call('PUT', '/api/settings', { calendarUrl: 'my calendar' })).status).toBe(400);
    const ok = await call('PUT', '/api/settings', { calendarUrl: 'webcal://calendar.test/private.ics', setAsidePercent: 20 });
    expect(ok.data).toMatchObject({ calendarUrl: 'webcal://calendar.test/private.ics', setAsidePercent: 20 });
    expect((await call('PUT', '/api/settings', { setAsidePercent: 80 })).status).toBe(400);
  });
});
