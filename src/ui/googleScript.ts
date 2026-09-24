// The Google Apps Script the person pastes into their own Google account. It looks for receipts
// in Gmail and Drive and sends only those to Honey, which reads them and keeps the purchases.
// Honey never holds a key to the inbox; the script holds a key to Honey that can only do this.

export function googleScript(honeyUrl: string, key: string, since: string): string {
  const sinceSlash = since.replace(/-/g, '/');
  return String.raw`/**
 * Honey receipt finder
 *
 * Runs inside your own Google account. It looks through your Gmail and Google Drive for
 * receipts, invoices and order confirmations, and sends only those to Honey. Honey reads each
 * one, keeps it if it's a purchase, and attaches it to the matching bank line.
 *
 * To start: choose "setup" in the function list at the top, press Run, and allow access.
 * After that it checks by itself every hour.
 */

const HONEY_URL = '${honeyUrl}';
const HONEY_KEY = '${key}';
const SINCE = '${sinceSlash}'; // the start of last tax year

// Gmail labels and Drive folders whose names mean money — your Money and Honey ones included.
const MONEY_NAMES = /money|honey|receipt|invoice|expense|financ|tax|bill|account|purchase|order|business/i;
const MONEY_WORDS = ['money', 'honey', 'receipt', 'invoice', 'expense', 'financ', 'tax', 'bill', 'account', 'business'];
// Receipt-looking emails anywhere in the inbox.
const RECEIPT_SEARCH = '{receipt invoice "order confirmation" "your order" "payment confirmation" "booking confirmation" "payment received" "tax invoice" VAT} -in:sent -in:chats -category:promotions -category:social';
const MAX_BYTES = 3 * 1024 * 1024; // larger attachments are skipped; the email text still goes
const TIME_LIMIT_MS = 5 * 60 * 1000; // Google stops a run at 6 minutes

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('findReceipts').timeBased().everyHours(1).create();
  findReceipts();
}

function findReceipts() {
  const started = Date.now();
  const candidates = gmailCandidates_().concat(driveCandidates_());
  const unseen = {};
  let waiting = 0;
  for (let i = 0; i < candidates.length; i += 1000) {
    const res = call_('unseen', { ids: candidates.slice(i, i + 1000).map(function (c) { return c.key; }) });
    (res.unseen || []).forEach(function (k) { unseen[k] = true; waiting++; });
  }
  let sent = 0;
  let kept = 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!unseen[c.key]) continue;
    if (Date.now() - started > TIME_LIMIT_MS) break;
    let item = null;
    try { item = c.load(); } catch (e) { console.log('Could not open ' + c.key + ': ' + e); }
    if (!item) continue;
    const res = call_('item', item);
    sent++;
    if (res.outcome === 'receipt') kept++;
  }
  console.log('Looked at ' + sent + ' new, kept ' + kept + ' as receipts. ' + (waiting - sent) + ' still to go (next run carries on).');
}

// ── Gmail ─────────────────────────────────────────────────────────────────────────

function gmailCandidates_() {
  const queries = [RECEIPT_SEARCH + ' after:' + SINCE];
  GmailApp.getUserLabels().forEach(function (label) {
    const name = label.getName();
    if (MONEY_NAMES.test(name)) queries.push('label:' + name.toLowerCase().replace(/[\s\/]+/g, '-') + ' after:' + SINCE);
  });
  const seen = {};
  const out = [];
  queries.forEach(function (q) {
    for (let start = 0; start < 1500; start += 100) {
      const threads = GmailApp.search(q, start, 100);
      threads.forEach(function (t) {
        const id = t.getId();
        if (seen[id]) return;
        seen[id] = true;
        out.push({ key: 'gmail:' + id, load: function () { return loadThread_(id); } });
      });
      if (threads.length < 100) break;
    }
  });
  return out;
}

function loadThread_(id) {
  const thread = GmailApp.getThreadById(id);
  if (!thread) return null;
  const me = (Session.getActiveUser().getEmail() || '').toLowerCase();
  const messages = thread.getMessages();
  const m = messages.filter(function (x) { return !me || x.getFrom().toLowerCase().indexOf(me) < 0; })[0] || messages[0];
  const type = function (a) { return String(a.getContentType()).split(';')[0].toLowerCase(); };
  const attachments = m.getAttachments({ includeInlineImages: false });
  const pdf = attachments.filter(function (a) { return type(a) === 'application/pdf' && a.getSize() <= MAX_BYTES; })[0];
  const photo = attachments
    .filter(function (a) { return /^image\/(jpeg|png|webp|gif)$/.test(type(a)) && a.getSize() > 15000 && a.getSize() <= MAX_BYTES; })
    .sort(function (a, b) { return b.getSize() - a.getSize(); })[0];
  const a = pdf || photo;
  return {
    id: id,
    source: 'gmail',
    from: m.getFrom(),
    subject: m.getSubject(),
    date: m.getDate().toISOString(),
    text: m.getPlainBody().slice(0, 12000),
    file: a ? { name: a.getName(), mime: type(a), dataBase64: Utilities.base64Encode(a.getBytes()) } : null,
  };
}

// ── Google Drive ──────────────────────────────────────────────────────────────────

function driveCandidates_() {
  const since = new Date(SINCE.replace(/\//g, '-') + 'T00:00:00');
  const seen = {};
  const out = [];
  const add = function (f) {
    const id = f.getId();
    if (seen[id] || out.length >= 3000) return;
    if (!/^(application\/pdf|image\/(jpeg|png|webp|gif))$/.test(f.getMimeType())) return;
    if (f.getSize() > MAX_BYTES || f.getLastUpdated() < since) return;
    seen[id] = true;
    out.push({ key: 'drive:' + id, load: function () { return loadFile_(id); } });
  };
  const walk = function (folder, depth) {
    const files = folder.getFiles();
    while (files.hasNext()) add(files.next());
    if (depth >= 3) return;
    const subfolders = folder.getFolders();
    while (subfolders.hasNext()) walk(subfolders.next(), depth + 1);
  };
  const named = MONEY_WORDS.map(function (w) { return "title contains '" + w + "'"; }).join(' or ');
  const folders = DriveApp.searchFolders('trashed = false and (' + named + ')');
  while (folders.hasNext()) walk(folders.next(), 0);
  const files = DriveApp.searchFiles("trashed = false and (title contains 'receipt' or title contains 'invoice')");
  while (files.hasNext()) add(files.next());
  return out;
}

function loadFile_(id) {
  const f = DriveApp.getFileById(id);
  return {
    id: id,
    source: 'drive',
    from: '',
    subject: f.getName(),
    date: f.getDateCreated().toISOString(),
    text: 'File "' + f.getName() + '" in Google Drive',
    file: { name: f.getName(), mime: f.getMimeType(), dataBase64: Utilities.base64Encode(f.getBlob().getBytes()) },
  };
}

// ── Talking to Honey ──────────────────────────────────────────────────────────────

function call_(what, payload) {
  const res = UrlFetchApp.fetch(HONEY_URL + '/api/google/script/' + what, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + HONEY_KEY },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  let body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) {}
  // Disconnected, or Honey can't read yet: stop, rather than hammer it.
  if (code === 401 || code === 400) throw new Error('Honey says: ' + (body.error || code));
  // Anything else (a hiccup reading one item): skip it; it's tried again next run.
  if (code >= 300) { console.log('Honey error ' + code + ': ' + (body.error || '')); return {}; }
  return body;
}
`;
}
