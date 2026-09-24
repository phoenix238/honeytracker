import { useEffect, useMemo, useState } from 'react';
import { T, fonts } from '../theme';
import { Button, Card, Field, Label, Money, Section, Title, fmtDate, inputStyle } from '../components';
import { exportCsvUrl } from '../api';
import { quarterlySummaries, sa103Lines, summarise, tradingStreams, type StreamSummary } from '../../core/ledger';
import { liability, ratesFor, tradingProfit } from '../../core/ukTax';
import { taxYearBounds, taxYearLabel, taxYearOf } from '../../core/dates';
import { formatAmount, formatGBP, parsePence } from '../../core/money';
import { factsFor, type TaxYearFacts } from '../../core/types';
import type { App } from '../useApp';

// Everything the tax return needs, already added up: the self-employment pages per stream
// with HMRC's box numbers, the quarterly figures Making Tax Digital asks for, the payment
// calendar, and a CSV for an accountant.

const MTD_STEPS = [
  { from: 2026, threshold: 5_000_000, basedOn: 2024 },
  { from: 2027, threshold: 3_000_000, basedOn: 2025 },
  { from: 2028, threshold: 2_000_000, basedOn: 2026 },
];

export function TaxView({ app }: { app: App }) {
  const data = app.data!;
  const p = app.picture!;
  const current = taxYearOf(data.today);
  const [year, setYear] = useState(current);
  const streams = new Map(data.streams.map((s) => [s.id, s]));

  const view = useMemo(() => {
    const summaries = summarise(data.transactions, taxYearBounds(year));
    const trading = tradingProfit(tradingStreams(summaries, data.streams), ratesFor(year).rates);
    const facts = factsFor(data.settings, year);
    return { summaries, trading, facts, bill: liability(trading.profitPence, facts, ratesFor(year).rates), quarters: quarterlySummaries(data.transactions, year) };
  }, [data, year]);

  const turnoverFor = (y: number) => summarise(data.transactions, taxYearBounds(y)).reduce((a, s) => a + s.turnoverPence, 0);
  const hasDataFor = (y: number) => data.transactions.some((t) => taxYearOf(t.date) === y);
  const years = [current - 2, current - 1, current, current + 1].filter((y) => y <= current);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Title
        right={
          <select style={{ ...inputStyle, width: 'auto' }} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{taxYearLabel(y)}</option>)}
          </select>
        }
      >
        Tax
      </Title>

      {year === current ? (
        <Card>
          <Label>{taxYearLabel(year)} estimate</Label>
          <Line label="Profit so far" pence={p.trading.profitPence} />
          <Line label={p.estimate.projectionBasis === 'expected' ? 'Whole year (your estimate)' : 'Whole year (projected)'} pence={p.estimate.projectedProfitPence} muted />
          <Line label="Income tax on that" pence={p.estimate.projectedLiability.incomeTaxPence} />
          <Line label="Class 4 National Insurance" pence={p.estimate.projectedLiability.class4Pence} />
          {p.estimate.projectedLiability.payeAdjustmentPence !== 0 && <Line label="PAYE under/over-paid" pence={p.estimate.projectedLiability.payeAdjustmentPence} />}
          <Line label="Whole-year bill" pence={p.estimate.projectedLiability.totalPence} bold />
          <div style={{ fontSize: 12, color: T.textMuted, marginTop: 8, lineHeight: 1.5 }}>
            Set aside <strong style={{ color: T.accentBright }}>{(p.estimate.setAsideRate * 100).toFixed(1)}%</strong> of profit.
            {p.estimate.lowConfidence && ' Only a few weeks of data so far — enter your expected profit below for a steadier figure.'}
            {p.estimate.ratesAssumed && ' This year’s rates aren’t in the app yet; last known rates used.'}
          </div>
        </Card>
      ) : (
        <Card>
          <Label>{taxYearLabel(year)} bill (from the ledger)</Label>
          <Line label="Taxable profit" pence={view.trading.profitPence} />
          <Line label="Income tax" pence={view.bill.incomeTaxPence} />
          <Line label="Class 4 National Insurance" pence={view.bill.class4Pence} />
          <Line label="Bill" pence={view.bill.totalPence} bold />
        </Card>
      )}

      {year === current && p.upcoming.length > 0 && (
        <Section title="HMRC payment calendar">
          <Card style={{ padding: 12 }}>
            {p.upcoming.map((x, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderTop: i ? `1px solid ${T.border}` : 'none' }}>
                <div>
                  <div style={{ fontSize: 13 }}>{x.label}</div>
                  <div style={{ fontSize: 11, color: T.textMuted }}>{fmtDate(x.due)}{x.estimated ? ' · estimate' : ''}</div>
                </div>
                <Money pence={x.amountPence} size={14} />
              </div>
            ))}
          </Card>
          <div style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.5 }}>
            Payments on account are each half of the previous year’s bill, paid in advance. After a year where income rises, January asks for that year’s balance and half of it again.
          </div>
        </Section>
      )}

      {view.trading.usesTradingAllowance && (
        <div style={{ fontSize: 12, color: T.green }}>
          The £1,000 trading allowance beats your actual costs this year, so it’s used instead of them.
        </div>
      )}

      <Section title="Self-employment pages (SA103)">
        {view.summaries.length === 0 && <div style={{ fontSize: 13, color: T.textFaint }}>No business income or costs recorded for {taxYearLabel(year)}.</div>}
        {view.summaries.map((s) => (
          <Sa103Card key={s.streamId ?? 'none'} s={s} name={s.streamId ? streams.get(s.streamId)?.name ?? 'Stream' : 'No stream set'} />
        ))}
        <a href={exportCsvUrl(year)} style={{ textDecoration: 'none' }}>
          <Button style={{ width: '100%' }}>Download {taxYearLabel(year)} ledger (CSV for an accountant)</Button>
        </a>
      </Section>

      <Section title="Quarterly updates (Making Tax Digital)">
        <Card style={{ padding: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 6, fontSize: 11, color: T.textMuted, fontFamily: fonts.mono }}>
            <span>Year to</span><span style={{ textAlign: 'right' }}>Income</span><span style={{ textAlign: 'right' }}>Costs</span>
          </div>
          {view.quarters.map((q) => {
            const inc = q.cumulative.reduce((a, s) => a + s.turnoverPence, 0);
            const cost = q.cumulative.reduce((a, s) => a + s.allowableExpensesPence, 0);
            return (
              <div key={q.index} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 6, padding: '8px 0', borderTop: `1px solid ${T.border}`, fontSize: 13 }}>
                <span>
                  {fmtDate(q.to)}
                  <span style={{ display: 'block', fontSize: 10, color: T.textMuted }}>due {fmtDate(q.deadline)}</span>
                </span>
                <span style={{ textAlign: 'right', fontFamily: fonts.mono }}>{formatGBP(inc)}</span>
                <span style={{ textAlign: 'right', fontFamily: fonts.mono }}>{formatGBP(cost)}</span>
              </div>
            );
          })}
        </Card>
        <Card style={{ padding: 12 }}>
          <Label>Do you need Making Tax Digital?</Label>
          {MTD_STEPS.map((m) => {
            const known = hasDataFor(m.basedOn);
            const turnover = turnoverFor(m.basedOn);
            const over = turnover > m.threshold;
            return (
              <div key={m.from} style={{ fontSize: 13, padding: '6px 0', lineHeight: 1.5 }}>
                From April {m.from} if {taxYearLabel(m.basedOn)} income was over {formatGBP(m.threshold)}:{' '}
                {known ? (
                  <strong style={{ color: over ? T.accentBright : T.green }}>
                    {formatGBP(turnover)} here — {over ? 'yes, likely' : 'no, on these figures'}
                  </strong>
                ) : (
                  <span style={{ color: T.textMuted }}>no data for that year in the app</span>
                )}
              </div>
            );
          })}
          <div style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.5, marginTop: 4 }}>
            HMRC counts self-employment and property income before costs, across all your businesses. If it applies, quarterly updates are sent through MTD-compatible software; these figures are what it asks for.
          </div>
        </Card>
      </Section>

      <FactsForm app={app} year={year} />

      <div style={{ fontSize: 11, color: T.textFaint, lineHeight: 1.6 }}>
        Estimates for setting money aside, for England, Wales & Northern Ireland rates. Not included: Scottish rates, student loans, pension contributions, Gift Aid,
        Marriage Allowance, savings/dividend income, Child Benefit charge, and offsetting a loss in one business against another. Check the final figures on HMRC’s
        own calculation before filing.
      </div>
    </div>
  );
}

function Line({ label, pence, bold, muted }: { label: string; pence: number; bold?: boolean; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: bold ? `1px solid ${T.border}` : 'none', marginTop: bold ? 4 : 0 }}>
      <span style={{ fontSize: 13, color: muted ? T.textMuted : T.text, fontWeight: bold ? 700 : 400 }}>{label}</span>
      <Money pence={pence} size={bold ? 16 : 14} color={muted ? T.textMuted : T.text} />
    </div>
  );
}

function Sa103Card({ s, name }: { s: StreamSummary; name: string }) {
  const lines = sa103Lines(s);
  return (
    <Card style={{ padding: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{name}</div>
      <Line label="Turnover (box 15)" pence={s.turnoverPence} />
      {lines.map((l) => (
        <div key={l.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, color: l.disallowable ? T.textMuted : T.text }}>
          <span>
            <span style={{ fontFamily: fonts.mono, fontSize: 10, color: T.textFaint }}>box {l.box} </span>
            {l.label}
            {l.disallowable ? ' (not allowable)' : ''}
          </span>
          <span style={{ fontFamily: fonts.mono }}>{formatGBP(l.amountPence)}</span>
        </div>
      ))}
      <Line label="Allowable costs" pence={s.allowableExpensesPence} />
      <Line label="Net profit" pence={s.profitPence} bold />
    </Card>
  );
}

function FactsForm({ app, year }: { app: App; year: number }) {
  const facts = factsFor(app.data!.settings, year);
  const toText = (p: number | null) => (p == null ? '' : formatAmount(p));
  const [f, setF] = useState<Record<keyof TaxYearFacts, string>>(() => ({
    employmentIncomePence: toText(facts.employmentIncomePence || null),
    payeTaxPence: toText(facts.payeTaxPence || null),
    priorYearLiabilityPence: toText(facts.priorYearLiabilityPence),
    paidToHmrcPence: toText(facts.paidToHmrcPence || null),
    expectedProfitPence: toText(facts.expectedProfitPence),
  }));
  useEffect(() => {
    setF({
      employmentIncomePence: toText(facts.employmentIncomePence || null),
      payeTaxPence: toText(facts.payeTaxPence || null),
      priorYearLiabilityPence: toText(facts.priorYearLiabilityPence),
      paidToHmrcPence: toText(facts.paidToHmrcPence || null),
      expectedProfitPence: toText(facts.expectedProfitPence),
    });
  }, [year]);

  const set = (k: keyof TaxYearFacts) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const opt = (v: string) => (v.trim() === '' ? null : parsePence(v));

  const save = () =>
    app.saveSettings({
      taxYears: {
        [String(year)]: {
          employmentIncomePence: opt(f.employmentIncomePence) ?? 0,
          payeTaxPence: opt(f.payeTaxPence) ?? 0,
          priorYearLiabilityPence: opt(f.priorYearLiabilityPence),
          paidToHmrcPence: opt(f.paidToHmrcPence) ?? 0,
          expectedProfitPence: opt(f.expectedProfitPence),
        },
      },
    });

  return (
    <Section title={`What the bank can’t tell me — ${taxYearLabel(year)}`}>
      <Card style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Expected profit for the whole year (£)" hint="Optional. Steadies the estimate early in the year.">
          <input style={inputStyle} inputMode="decimal" value={f.expectedProfitPence} onChange={set('expectedProfitPence')} />
        </Field>
        <Field label="Pay from a PAYE job this year (£)" hint="From payslips or your P60. It uses up your tax-free allowance first.">
          <input style={inputStyle} inputMode="decimal" value={f.employmentIncomePence} onChange={set('employmentIncomePence')} />
        </Field>
        <Field label="Tax taken through PAYE (£)">
          <input style={inputStyle} inputMode="decimal" value={f.payeTaxPence} onChange={set('payeTaxPence')} />
        </Field>
        <Field label={`${taxYearLabel(year - 1)} Self Assessment bill (£)`} hint="HMRC’s figure from last year’s calculation. Sets this year’s payments on account. Leave blank to use the app’s own estimate.">
          <input style={inputStyle} inputMode="decimal" value={f.priorYearLiabilityPence} onChange={set('priorYearLiabilityPence')} />
        </Field>
        <Field label={`Already paid to HMRC towards ${taxYearLabel(year)} (£)`}>
          <input style={inputStyle} inputMode="decimal" value={f.paidToHmrcPence} onChange={set('paidToHmrcPence')} />
        </Field>
        <Button tone="primary" onClick={save} disabled={app.busy}>Save</Button>
      </Card>
    </Section>
  );
}
