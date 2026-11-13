import { describe, expect, it } from 'vitest';
import { verifiedForwardGuidance } from '../backend/guidance';
import { buildSnapshot } from '../backend/collect';
import type { ForwardGuidance } from '../shared/schema';
const guide: ForwardGuidance = {
  from: { period: '2026-Q4', growthRate: 2.5, coreInflationRate: 3.2 },
  to: { period: '2027-Q4', growthRate: 2.2, coreInflationRate: 2.5 },
  growthMeasure: 'real-gdp-q4q4',
  inflationMeasure: 'core-pce-yoy',
  growthQuote: 'Real GDP (Q4/Q4 %) 2.0% 2.5% 2.2%',
  inflationQuote: 'Core PCE (Q4/Q4 %) 2.8% 3.2% 2.5%',
  periodQuote: 'Annual (Q4/Q4) Indicator 2025 2026f 2027f',
};
const text = [guide.periodQuote, guide.growthQuote, guide.inflationQuote].join(' ');
describe('Published forward guidance needs paired source evidence', () => {
  it('verifies table headers and both forecast columns', () => {
    expect(verifiedForwardGuidance(text, guide)).toEqual(guide);
  });
  it('completes a truncated quote using only its same original sentence', () => {
    const growthQuote = 'Real GDP growth is forecast at 2.5% Q4-over-Q4 in 2026 and 2.2% in 2027.';
    const inflationQuote =
      'We expect core PCE inflation of 3.2% year-over-year in Q4 2026 before easing to 2.5% in Q4 2027.';
    const candidate = {
      ...guide,
      growthQuote: growthQuote.split(' and ')[0],
      inflationQuote: inflationQuote.split(' before ')[0],
      periodQuote: growthQuote,
    };
    expect(verifiedForwardGuidance(growthQuote + ' ' + inflationQuote, candidate)).toMatchObject({
      growthQuote,
      inflationQuote,
    });
  });
  it('rejects invented numbers and a wrong source-table column', () => {
    expect(
      verifiedForwardGuidance(text, { ...guide, to: { ...guide.to, growthRate: 1.5 } }),
    ).toBeUndefined();
    expect(
      verifiedForwardGuidance(text, { ...guide, from: { ...guide.from, growthRate: 2 } }),
    ).toBeUndefined();
  });
  it('rejects missing horizons, reversed chronology, and a one-endpoint forecast', () => {
    expect(
      verifiedForwardGuidance(text, { ...guide, periodQuote: '2026 and 2027 projections' }),
    ).toBeUndefined();
    expect(
      verifiedForwardGuidance(text, { ...guide, to: { ...guide.to, period: '2025-Q4' } }),
    ).toBeUndefined();
    const partial = {
      ...guide,
      inflationQuote: 'Core PCE inflation should reach 2.5% year over year.',
    };
    expect(verifiedForwardGuidance(text + ' ' + partial.inflationQuote, partial)).toBeUndefined();
  });
  it('rejects core CPI, mixed measures and risk scenarios even with real quoted numbers', () => {
    const cpi = { ...guide, inflationQuote: guide.inflationQuote.replace('PCE', 'CPI') };
    expect(verifiedForwardGuidance(text.replace('PCE', 'CPI'), cpi)).toBeUndefined();
    expect(
      verifiedForwardGuidance(text, { ...guide, growthMeasure: 'real-gdp-annual-average' }),
    ).toBeUndefined();
    const risk = { ...guide, growthQuote: 'In a risk scenario: ' + guide.growthQuote };
    expect(
      verifiedForwardGuidance('In a risk scenario: ' + text + ' ' + risk.growthQuote, risk),
    ).toBeUndefined();
  });
  it('rejects third-party forecasts even when the model crops away the attribution', () => {
    expect(
      verifiedForwardGuidance(
        guide.periodQuote +
          '. The Fed forecasts ' +
          guide.growthQuote +
          '. ' +
          guide.inflationQuote,
        guide,
      ),
    ).toBeUndefined();
  });
  it('does not present historical period pairs as forward guidance', () => {
    expect(verifiedForwardGuidance(text, guide, '2028-02-01T12:00:00.000Z')).toBeUndefined();
    expect(verifiedForwardGuidance(text, guide, '2026-11-13T12:00:00.000Z')).toBeDefined();
  });
  it('retains validated guidance in the daily collector, without needing a hard-data anchor', async () => {
    const html = `<article><time datetime="2026-11-13">November 13, 2026</time>${text} ${'Additional U.S. macro forecast commentary. '.repeat(20)}</article>`;
    const fetcher = (async (input: RequestInfo | URL) =>
      String(input).includes('pimco.com')
        ? new Response(html)
        : new Response('offline', { status: 503 })) as typeof fetch;
    const result = await buildSnapshot({
      now: '2026-11-13T22:00:00.000Z',
      axisMode: 'levels',
      fetcher,
      sources: [
        {
          id: 'test',
          name: 'Test',
          shortName: 'Test',
          color: '#123456',
          mode: 'article',
          type: 'commentary',
          url: 'https://www.pimco.com/us/en/insights/test',
        },
      ],
      assess: async () => ({
        growth: 'stable',
        inflation: 'stable',
        horizon: 'outlook',
        confidence: 'medium',
        growthRate: 2.2,
        coreInflationRate: 2.5,
        growthBasis: 'direct',
        inflationBasis: 'direct',
        growthQuote: guide.growthQuote,
        inflationQuote: guide.inflationQuote,
        rationale: 'Published future forecast table.',
        forwardGuidance: [guide],
      }),
    });
    expect(result.points).toHaveLength(1);
    expect(result.points[0].forwardGuidance).toEqual(guide);
    expect(result.points[0].guidanceReviewVersion).toBe('source-guidance-v1');
  });
});
