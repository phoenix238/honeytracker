import ICAL from 'ical.js';
import type { IsoDate } from '../src/core/types.js';

// Your calendar, read from its private iCal link (Google: Settings → the calendar → "Secret address
// in iCal format"; Apple: share the calendar publicly). Honey only reads it — to turn sessions or
// shifts into invoice lines — and never writes to it. Repeating events are expanded, moved or
// cancelled occurrences respected, and every time is given in UK time.

export interface CalendarEvent {
  id: string;
  title: string;
  date: IsoDate;
  /** "HH:MM", UK time; null for all-day events. */
  start: string | null;
  end: string | null;
  /** Length in hours (two decimals); null for all-day events. */
  hours: number | null;
  location: string;
}

const LONDON = 'Europe/London';
const MAX_OCCURRENCES = 20_000;

const pad = (n: number) => String(n).padStart(2, '0');

/** A time's UK calendar date and clock time. Times with no zone Honey knows are taken as UK time. */
function ukParts(t: ICAL.Time): { date: IsoDate; clock: string; ms: number } {
  const zoned = t.zone === ICAL.Timezone.utcTimezone || (t.zone && t.zone !== ICAL.Timezone.localTimezone && t.zone.tzid !== 'floating');
  if (!zoned) {
    // Floating (or an unknown zone): the numbers are already the wall-clock time.
    const ms = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute);
    return { date: `${t.year}-${pad(t.month)}-${pad(t.day)}`, clock: `${pad(t.hour)}:${pad(t.minute)}`, ms };
  }
  const d = t.toJSDate();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: LONDON, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, clock: `${parts.hour}:${parts.minute}`, ms: d.getTime() };
}

export function eventsBetween(ics: string, from: IsoDate, to: IsoDate): CalendarEvent[] {
  const root = new ICAL.Component(ICAL.parse(ics));
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    try {
      ICAL.TimezoneService.register(tz);
    } catch {
      /* a broken zone falls back to UK time */
    }
  }
  const vevents = root.getAllSubcomponents('vevent');
  // Moved or edited single occurrences of a repeating event arrive as their own VEVENTs.
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const v of vevents) {
    const e = new ICAL.Event(v);
    if (e.isRecurrenceException()) exceptions.push(e);
    else masters.set(e.uid, e);
  }
  for (const ex of exceptions) masters.get(ex.uid)?.relateException(ex);

  // Search a day wider each side: a UTC time can fall on the neighbouring UK date.
  const lo = ICAL.Time.fromDateString(from);
  lo.adjust(-1, 0, 0, 0);
  const hi = ICAL.Time.fromDateString(to);
  hi.adjust(2, 0, 0, 0);

  const out: CalendarEvent[] = [];
  const push = (item: ICAL.Event, start: ICAL.Time, end: ICAL.Time | null) => {
    if (String(item.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') return;
    const allDay = start.isDate;
    const s = ukParts(start);
    if (s.date < from || s.date > to) return;
    const e = end && !allDay ? ukParts(end) : null;
    out.push({
      id: `${item.uid}|${start.toString()}`,
      title: (item.summary ?? '').trim() || '(no title)',
      date: s.date,
      start: allDay ? null : s.clock,
      end: allDay ? null : e?.clock ?? null,
      hours: allDay || !e ? null : Math.round(((e.ms - s.ms) / 3_600_000) * 100) / 100,
      location: (item.location ?? '').trim(),
    });
  };

  for (const ev of masters.values()) {
    if (!ev.startDate) continue;
    if (!ev.isRecurring()) {
      push(ev, ev.startDate, ev.endDate ?? null);
      continue;
    }
    const it = ev.iterator();
    for (let i = 0, next = it.next(); next && i < MAX_OCCURRENCES; i++, next = it.next()) {
      if (next.compare(hi) > 0) break;
      if (next.compare(lo) < 0) continue;
      const d = ev.getOccurrenceDetails(next);
      push(d.item, d.startDate, d.endDate);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? '').localeCompare(b.start ?? ''));
}

/** Fetch a private calendar link. Only https (webcal:// is the same address) and never a local address. */
export async function fetchCalendar(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const u = new URL(url.trim().replace(/^webcals?:\/\//i, 'https://'));
  if (u.protocol !== 'https:') throw new Error('The calendar link must start with https:// or webcal://');
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[?::1)/i.test(u.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname)) {
    throw new Error('That calendar link points at a private address.');
  }
  const res = await fetchImpl(u.toString(), { signal: AbortSignal.timeout(15_000), headers: { Accept: 'text/calendar' } });
  if (!res.ok) throw new Error(`The calendar couldn’t be read (it answered ${res.status}) — check the link is the private iCal address.`);
  const text = await res.text();
  if (text.length > 15_000_000) throw new Error('That calendar is too big to read.');
  if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('That link didn’t return a calendar — use the iCal (.ics) address, not the web page.');
  return text;
}
