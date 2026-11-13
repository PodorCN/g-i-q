import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { collectLevels, levelDataPoint } from '../backend/levels';
import { buildSnapshot, type Assess } from '../backend/collect';
import { articleText } from '../backend/documents';
import { verifiedSnippet } from '../backend/analysis';
import { SnapshotSchema, regime } from '../shared/schema';
import Chart from '../frontend/Chart';

const now = '2026-11-13T18:00:00.000Z';
const growthQuote = 'We expect real US growth of 2.5% in 2027.';
const inflationQuote = 'Core PCE inflation should fall to 3.2% by year end.';
const article = `<script type="application/ld+json">{"headline":"US outlook","datePublished":"2026-11-12"}</script><main>${growthQuote} ${inflationQuote} ${'Supporting economic analysis. '.repeat(20)}</main>`;
const fetcher = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('api.bls.gov')) return Response.json({ status: 'REQUEST_FAILED' });
  if (url.includes('atlantafed.org'))
    return Response.json({
      ResearchData: [
        { IconAlias: 'GDPNow', Indicator: '3.5%', UpdatedDate: '2026-11-09', Name: 'Q4 GDPNow' },
      ],
    });
  if (url.includes('bea.gov/data/gdp/'))
    return new Response(
      '<main>Real gross domestic product (GDP) increased at an annual rate of 3.4 percent in the third quarter of 2026.</main>',
    );
  if (url.includes('bea.gov/')) return new Response('<main>September 2026 +3.1%</main>');
  return new Response(article);
}) as typeof fetch;

describe('Growth and inflation level coordinates', () => {
  it('parses official anchors and subtracts explicit benchmarks', async () => {
    const result = await collectLevels(now, fetcher);
    expect(result.sources.every((s) => s.status === 'ok')).toBe(true);
    expect(result.indicators.map((i) => i.value)).toEqual([3.4, 3.1, 3.5]);
    const point = levelDataPoint(result.indicators, now)!;
    expect(point.x).toBeCloseTo(1.45);
    expect(point.y).toBeCloseTo(1.1);
    expect(point.axisMode).toBe('levels');
    expect(point.rangeKind).toBe('model_range');
    expect(levelDataPoint(result.indicators, '2027-07-01T00:00:00Z')).toBeNull();
  });

  it('maps falling but above-target inflation above the horizontal axis', async () => {
    const assess: Assess = async () => ({
      growth: 'stable',
      inflation: 'decelerating',
      horizon: 'outlook',
      growthRate: 2.5,
      coreInflationRate: 3.2,
      growthSigma: 0.5,
      inflationSigma: 0.4,
      growthBasis: 'direct',
      inflationBasis: 'direct',
      horizonLabel: '2027 baseline',
      growthQuote,
      inflationQuote,
      rationale: 'Explicit growth and core PCE forecasts.',
      confidence: 'medium',
    });
    const snapshot = await buildSnapshot({
      now,
      fetcher,
      assess,
      axisMode: 'levels',
      sources: [
        {
          id: 'test',
          name: 'Test house',
          shortName: 'Test',
          color: '#123456',
          url: 'https://www.pimco.com/us/en/insights/test',
          mode: 'article',
          type: 'commentary',
        },
      ],
    });
    const point = snapshot.points.find((p) => p.kind === 'institution')!;
    expect(point.x).toBeCloseTo(0.5);
    expect(point.y).toBeCloseTo(1.2);
    expect(point.growthBasis).toBe('direct');
    expect(point.inflationDirection).toBeUndefined();
    expect(regime(point.x, point.y)).toBe('Overheating');
    expect(point.horizonLabel).toBe('2027 baseline');
  });

  it('retains original observation timestamps after provider failure', async () => {
    const before = await collectLevels(now, fetcher);
    const offline = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    const after = await collectLevels('2026-11-14T18:00:00Z', offline, before.indicators);
    expect(after.indicators).toEqual(before.indicators);
    expect(
      after.sources.every((s) => s.status === 'error' && s.message.includes('Retaining')),
    ).toBe(true);
  });
});

describe('Publisher evidence and the live chart', () => {
  it('accepts typography differences while rejecting changed words', () => {
    const text = 'We expect resilient U.S. growth; inflation remains above target.';
    expect(verifiedSnippet(text, 'we expect resilient U.S. growth', 'growth')).not.toBe('');
    expect(verifiedSnippet(text, 'inflation remains above target', 'inflation')).not.toBe('');
    expect(verifiedSnippet(text, 'inflation does not remain above target', 'inflation')).toBe('');
  });

  it('does not let an indented main shell hide a substantive sibling article', () => {
    const result = articleText(
      `<main>${'\n    '.repeat(800)}Short shell</main><div>${growthQuote} ${inflationQuote} ${'Actual research. '.repeat(150)}</div>`,
    );
    expect(result).toContain(growthQuote);
    expect(result).toContain(inflationQuote);
  });

  it('renders every real house, its range, and the level-axis labels', () => {
    const snapshot = SnapshotSchema.parse(JSON.parse(readFileSync('data/latest.json', 'utf8')));
    const houses = snapshot.points.filter((p) => p.kind === 'institution');
    expect(houses.length).toBeGreaterThanOrEqual(7);
    const svg = renderToStaticMarkup(
      <Chart
        points={snapshot.points}
        selectedId="hard-data"
        onSelect={() => {}}
        showRanges
        showLabels
      />,
    );
    for (const house of houses) expect(svg).toContain(house.shortName);
    expect(svg).toContain('Growth vs 2% trend');
    expect(svg).toContain('Core inflation vs 2% target');
    expect((svg.match(/<ellipse/g) || []).length).toBe(snapshot.points.length);
    expect(snapshot.demo).toBe(false);
  });
});
