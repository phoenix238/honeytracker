import { describe, it, expect } from 'vitest';
import { eventsBetween, fetchCalendar } from '../calendar';

// A calendar as Google writes it: a UK time zone block, a weekly shift that crosses the October
// clock change, one week moved and one cancelled, plus UTC, all-day and floating events.
const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/London',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0000',
  'TZOFFSETTO:+0100',
  'TZNAME:BST',
  'DTSTART:19700329T010000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0000',
  'TZNAME:GMT',
  'DTSTART:19701025T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:shift-1@google.com',
  'SUMMARY:Ethical Caff shift',
  'DTSTART;TZID=Europe/London:20261014T100000',
  'DTEND;TZID=Europe/London:20261014T130000',
  'RRULE:FREQ=WEEKLY;COUNT=5',
  'EXDATE;TZID=Europe/London:20261021T100000',
  'LOCATION:Ethical Caff',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:shift-1@google.com',
  'RECURRENCE-ID;TZID=Europe/London:20261028T100000',
  'SUMMARY:Ethical Caff shift (late start)',
  'DTSTART;TZID=Europe/London:20261028T110000',
  'DTEND;TZID=Europe/London:20261028T150000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:utc-1',
  'SUMMARY:Filming',
  'DTSTART:20261016T083000Z',
  'DTEND:20261016T113000Z',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:allday-1',
  'SUMMARY:Workshop day',
  'DTSTART;VALUE=DATE:20261020',
  'DTEND;VALUE=DATE:20261021',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:floating-1',
  'SUMMARY:Client session',
  'DTSTART:20261022T163000',
  'DTEND:20261022T173000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:cancelled-1',
  'SUMMARY:Called off',
  'STATUS:CANCELLED',
  'DTSTART:20261023T100000Z',
  'DTEND:20261023T110000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('calendar', () => {
  it('expands repeats across the clock change, respects moved and cancelled ones, and gives UK times', () => {
    const got = eventsBetween(ICS, '2026-10-01', '2026-11-30').map((e) => [e.date, e.start, e.end, e.hours, e.title]);
    expect(got).toEqual([
      ['2026-10-14', '10:00', '13:00', 3, 'Ethical Caff shift'],
      ['2026-10-16', '09:30', '12:30', 3, 'Filming'], // 08:30 UTC is 09:30 BST
      ['2026-10-20', null, null, null, 'Workshop day'],
      ['2026-10-22', '16:30', '17:30', 1, 'Client session'],
      ['2026-10-28', '11:00', '15:00', 4, 'Ethical Caff shift (late start)'], // moved
      ['2026-11-04', '10:00', '13:00', 3, 'Ethical Caff shift'], // after the clocks go back, still 10:00
      ['2026-11-11', '10:00', '13:00', 3, 'Ethical Caff shift'],
    ]);
  });

  it('only returns the dates asked for', () => {
    expect(eventsBetween(ICS, '2026-11-01', '2026-11-05').map((e) => e.date)).toEqual(['2026-11-04']);
  });

  it('refuses links that aren’t a calendar, or point somewhere private', async () => {
    await expect(fetchCalendar('http://calendar.test/x.ics')).rejects.toThrow(/https/);
    await expect(fetchCalendar('https://localhost/x.ics')).rejects.toThrow(/private/);
    const page = (async () => new Response('<html>sign in</html>')) as unknown as typeof fetch;
    await expect(fetchCalendar('webcal://calendar.test/x.ics', page)).rejects.toThrow(/iCal/);
    const ok = (async (u: string) => new Response(u.startsWith('https://') ? ICS : '')) as unknown as typeof fetch;
    expect(await fetchCalendar('webcal://calendar.test/x.ics', ok)).toContain('BEGIN:VCALENDAR');
  });
});
