import { describe, expect, it } from 'vitest';
import { buildSnapshot, type Assess } from '../backend/collect';
import type { CommentarySource } from '../backend/sources';

const now = '2026-11-13T12:00:00.000Z';
const growth = 'US economic growth is accelerating.';
const inflation = 'US inflation is cooling.';
const html = `<html><script type="application/ld+json">{"headline":"Test commentary","datePublished":"2026-11-12"}</script><main>${growth} ${inflation} <p>${'Supporting discussion about economic statistics. '.repeat(15)}</p></main></html>`;
const source: CommentarySource = {
  id: 'test-source',
  name: 'Test institution',
  shortName: 'Test',
  color: '#4268ca',
  mode: 'article',
  type: 'commentary',
  url: 'https://www.pimco.com/us/en/insights/test-article',
};
const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('api.bls.gov')) {
    const ids =
      init?.method === 'POST'
        ? (JSON.parse(String(init.body)).seriesid as string[])
        : [url.split('/').at(-1)!];
    const data = Array.from({ length: 34 }, (_, i) => ({
      year: String(2024 + Math.floor(i / 12)),
      period: `M${String((i % 12) + 1).padStart(2, '0')}`,
      value: String(100 + i * 0.2 + Math.sin(i * 0.7) * 0.1),
    }));
    return Response.json({
      status: 'REQUEST_SUCCEEDED',
      Results: { series: ids.map((id) => ({ seriesID: id, data })) },
    });
  }
  return new Response(html);
}) as typeof fetch;
const assess: Assess = async () => ({
  growth: 'accelerating',
  inflation: 'decelerating',
  horizon: 'current',
  growthQuote: growth,
  inflationQuote: inflation,
  rationale: 'Both directional statements are supported by the test source.',
  confidence: 'medium',
});

describe('Collection, evidence validation and abstention', () => {
  it('requests all five BLS series in one batch', async () => {
    const requests: RequestInit[] = [];
    const observed = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('api.bls.gov')) requests.push(init!);
      return fetcher(input, init);
    }) as typeof fetch;
    await buildSnapshot({ now, fetcher: observed, assess, sources: [] });
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('POST');
    expect(JSON.parse(String(requests[0].body)).seriesid).toHaveLength(5);
  });
  it('constructs a validated data composite and attributable institution point', async () => {
    const result = await buildSnapshot({ now, fetcher, assess, sources: [source] });
    expect(result.points).toHaveLength(2);
    const institution = result.points.find((point) => point.kind === 'institution')!;
    expect(institution.institution).toBe(source.name);
    expect(institution.sourceUrl).toBe(source.url);
    expect(institution.rangeKind).toBe('model_range');
    expect(result.indicators).toHaveLength(5);
  });
  it('rejects an invented supporting quote even if the model assigns a direction', async () => {
    const result = await buildSnapshot({
      now,
      fetcher,
      sources: [source],
      assess: async (...args) => ({
        ...(await assess(...args)),
        growthQuote: 'Invented forecast which was not in the article.',
      }),
    });
    expect(result.points.filter((point) => point.kind === 'institution')).toHaveLength(0);
    expect(result.documents[0].reason).toContain('verbatim');
  });
  it('maps a partially identified view with a wide unresolved-axis range', async () => {
    const result = await buildSnapshot({
      now,
      fetcher,
      sources: [source],
      assess: async (...args) => ({ ...(await assess(...args)), growth: 'unclear' }),
    });
    expect(result.documents[0].status).toBe('scored');
    const point = result.points.find((point) => point.kind === 'institution')!;
    expect(point.growthDirection).toBe('unclear');
    expect(point.x).toBe(0);
    expect(point.xRange.low).toBeLessThan(0);
    expect(point.xRange.high).toBeGreaterThan(0);
  });
  it('preserves an author’s multi-year horizon rather than hiding the view', async () => {
    const longQuote = 'We expect respectable US growth over the next couple of years.';
    const longFetcher = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('api.bls.gov')
        ? fetcher(input, init)
        : new Response(html.replace(growth, longQuote))) as typeof fetch;
    const result = await buildSnapshot({
      now,
      fetcher: longFetcher,
      sources: [source],
      assess: async (...args) => ({
        ...(await assess(...args)),
        growth: 'unclear',
        horizon: 'outlook',
        horizonLabel: '2027 baseline',
        growthQuote: longQuote,
      }),
    });
    const point = result.points.find((point) => point.kind === 'institution')!;
    expect(point.horizon).toBe('outlook');
    expect(point.horizonLabel).toBe('2027 baseline');
    expect(point.growthDirection).toBe('unclear');
  });
  it('keeps a level-only growth view on the map without calling it stable momentum', async () => {
    const result = await buildSnapshot({
      now,
      fetcher,
      sources: [source],
      assess: async (...args) => ({ ...(await assess(...args)), growth: 'stable' }),
    });
    const point = result.points.find((point) => point.kind === 'institution')!;
    expect(point.growthDirection).toBe('unclear');
    expect(point.xRange).toEqual({ low: -1.1, high: 1.1 });
  });
  it('preserves an explicit forecast horizon', async () => {
    const result = await buildSnapshot({
      now,
      fetcher,
      sources: [source],
      assess: async (...args) => ({ ...(await assess(...args)), horizon: 'outlook' }),
    });
    expect(result.points.find((point) => point.kind === 'institution')!.horizon).toBe('outlook');
  });
  it('refuses to manufacture a successful snapshot when every source fails', async () => {
    const offline = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    await expect(buildSnapshot({ now, fetcher: offline, sources: [source] })).rejects.toThrow(
      'No usable data',
    );
  });
});
