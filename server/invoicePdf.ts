import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { BusinessProfile, Invoice } from '../src/core/types.js';
import { invoiceTotal, lineAmount } from '../src/core/invoices.js';
import { formatGBP } from '../src/core/money.js';

// The invoice as a one-page (or more) A4 PDF — a real file to attach to an email or share
// from the phone. Once paid, the same document prints as a receipt: "PAID", the date the
// money arrived, and no bank details or due date.

const W = 595.28;
const H = 841.89;
const M = 56;
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.42, 0.42, 0.42);
const ACCENT = rgb(0.74, 0.53, 0.1);

// Standard PDF fonts can only draw WinAnsi characters; anything else (emoji, most non-Latin
// scripts) would throw, so it's swapped for "?" rather than failing the whole document.
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
function safe(text: string): string {
  return [...text]
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      if (ch === '\n') return ch;
      if ((c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.includes(ch)) return ch;
      return '?';
    })
    .join('');
}

function fmtDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(tryLine, size) > width && line) {
        out.push(line);
        line = word;
      } else line = tryLine;
    }
    out.push(line);
  }
  return out;
}

export async function buildInvoicePdf(inv: Invoice, profile: BusinessProfile, paidOn: string | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const receipt = Boolean(paidOn);
  doc.setTitle(`${receipt ? 'Receipt' : 'Invoice'} ${inv.number}`);
  doc.setAuthor(profile.businessName || profile.name);

  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const text = (s: string, x: number, size = 10, f: PDFFont = font, color = INK) =>
    page.drawText(safe(s), { x, y, size, font: f, color });
  const right = (s: string, xRight: number, size = 10, f: PDFFont = font, color = INK) =>
    page.drawText(safe(s), { x: xRight - f.widthOfTextAtSize(safe(s), size), y, size, font: f, color });
  const newPageIfNeeded = (need: number) => {
    if (y - need > M) return;
    page = doc.addPage([W, H]);
    y = H - M;
  };

  // Header: who it's from, and what it is.
  text(profile.businessName || profile.name || 'Invoice', M, 18, bold);
  right(receipt ? 'RECEIPT' : 'INVOICE', W - M, 18, bold, receipt ? rgb(0.2, 0.55, 0.3) : ACCENT);
  y -= 18;
  for (const l of [profile.businessName && profile.name ? profile.name : '', ...profile.address.split('\n'), profile.email, profile.phone].filter(Boolean)) {
    text(l, M, 9, font, MUTED);
    y -= 12;
  }

  // Meta block.
  y -= 14;
  const metaTop = y;
  text('Bill to', M, 9, bold, MUTED);
  y -= 14;
  text(inv.clientName || '—', M, 11, bold);
  y -= 13;
  for (const l of [...inv.clientAddress.split('\n'), inv.clientEmail].filter(Boolean)) {
    text(l, M, 9, font, MUTED);
    y -= 12;
  }
  const leftBottom = y;
  y = metaTop;
  const meta: [string, string][] = [
    [receipt ? 'Receipt for' : 'Invoice no.', inv.number],
    ['Date', fmtDate(inv.issueDate)],
    ...(receipt ? ([['Paid', fmtDate(paidOn!)]] as [string, string][]) : ([['Due', fmtDate(inv.dueDate)]] as [string, string][])),
  ];
  for (const [k, v] of meta) {
    right(k, W - M - 130, 9, font, MUTED);
    right(v, W - M, 10, bold);
    y -= 15;
  }
  y = Math.min(y, leftBottom) - 24;

  // Lines.
  const cols = { qty: W - M - 190, rate: W - M - 95, amt: W - M };
  text('Description', M, 9, bold, MUTED);
  right('Qty', cols.qty, 9, bold, MUTED);
  right('Rate', cols.rate, 9, bold, MUTED);
  right('Amount', cols.amt, 9, bold, MUTED);
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: MUTED });
  y -= 16;
  for (const l of inv.lines) {
    const desc = wrap(l.description || '—', font, 10, cols.qty - M - 50);
    newPageIfNeeded(desc.length * 13 + 10);
    const qty = Number.isInteger(l.quantity) ? String(l.quantity) : l.quantity.toFixed(2).replace(/0$/, '');
    right(qty, cols.qty);
    right(formatGBP(l.unitPence), cols.rate);
    right(formatGBP(lineAmount(l)), cols.amt);
    for (const d of desc) {
      text(d, M);
      y -= 13;
    }
    y -= 5;
  }
  y -= 2;
  page.drawLine({ start: { x: cols.qty - 40, y }, end: { x: W - M, y }, thickness: 0.6, color: MUTED });
  y -= 20;
  right(receipt ? 'Total paid' : 'Total due', cols.rate, 11, bold);
  right(formatGBP(invoiceTotal(inv)), cols.amt, 13, bold);
  y -= 34;

  // How to pay (or confirmation it's paid).
  newPageIfNeeded(110);
  if (receipt) {
    text(`Paid in full on ${fmtDate(paidOn!)}.`, M, 11, bold, rgb(0.2, 0.55, 0.3));
    y -= 20;
  } else if (profile.sortCode || profile.accountNumber) {
    text('How to pay', M, 10, bold);
    y -= 15;
    for (const [k, v] of [
      ['Account name', profile.businessName || profile.name],
      ['Sort code', profile.sortCode],
      ['Account number', profile.accountNumber],
      ['Reference', inv.number],
    ] as [string, string][]) {
      if (!v) continue;
      text(k, M, 10, font, MUTED);
      text(v, M + 110, 10, k === 'Reference' ? bold : font);
      y -= 14;
    }
    y -= 4;
    text(`Please use ${inv.number} as the payment reference so it's matched to this invoice.`, M, 9, font, MUTED);
    y -= 20;
  }
  for (const block of [inv.notes, profile.footer].filter(Boolean)) {
    for (const l of wrap(block, font, 9, W - 2 * M)) {
      newPageIfNeeded(14);
      text(l, M, 9, font, MUTED);
      y -= 12;
    }
    y -= 8;
  }
  return doc.save();
}
