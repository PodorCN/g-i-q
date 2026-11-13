import { describe, expect, it } from 'vitest';
import {
  assessRules,
  bootstrap,
  calculateIndicator,
  dataPoint,
  momentum,
  quoteWindow,
  type Observation,
} from '../backend/analysis';
import { isStale, PointSchema } from '../shared/schema';
import {
  normalizeDate,
  metadata,
  articleText,
  discoverLinks,
  parseFeed,
} from '../backend/documents';
import { readPublic } from '../backend/http';
import { SERIES } from '../backend/sources';

const NOW = '2026-11-13T12:00:00.000Z';
const observations = (length = 34): Observation[] =>
  Array.from({ length }, (_, index) => ({
    date: new Date(Date.UTC(2024, index, 1)).toISOString().slice(0, 10),
    value: 100 + index * 0.4 + Math.sin(index / 2) * 0.3,
  }));
const meta = { ...SERIES[0], provider: 'BLS', sourceUrl: 'https://www.bls.gov/data/' };

describe('Sign-preserving momentum and missing releases', () => {
  it('computes payroll additions rather than treating a payroll level as growth', () => {
    const rows = observations();
    expect(momentum(rows, 33, 'payroll')).toBeCloseTo((rows[33].value - rows[30].value) / 3);
  });
  it('computes annualized inflation from a price index, not a change in annual inflation', () => {
    const rows = observations();
    expect(momentum(rows, 33, 'annualized')).toBeCloseTo(
      ((rows[33].value / rows[30].value) ** 4 - 1) * 100,
    );
  });
  it('inverts unemployment for the growth axis', () => {
    const rows = observations();
    expect(momentum(rows, 33, 'unemployment')).toBeCloseTo(-(rows[33].value - rows[30].value));
  });
  it('allows an older missing release without bridging that gap in calibration', () => {
    const rows = observations().filter((_, i) => i !== 12);
    const result = calculateIndicator(meta, rows, 'payroll', NOW);
    expect(Number.isFinite(result.score)).toBe(true);
    expect(Math.sign(result.score)).toBe(Math.sign(result.acceleration));
  });
  it('abstains when a recent month is missing', () => {
    expect(() =>
      calculateIndicator(
        meta,
        observations().filter((_, i) => i !== 31),
        'payroll',
        NOW,
      ),
    ).toThrow('missing months');
  });
  it('ignores a future release and rejects duplicate months', () => {
    const rows = observations();
    const base = calculateIndicator(meta, rows, 'payroll', NOW);
    expect(
      calculateIndicator(meta, [...rows, { date: '2027-01-01', value: 99999 }], 'payroll', NOW)
        .score,
    ).toEqual(base.score);
    expect(() => calculateIndicator(meta, [...rows, rows[0]], 'payroll', NOW)).toThrow('duplicate');
  });
  it('rejects a flat history instead of inventing a normalization scale', () => {
    expect(() =>
      calculateIndicator(
        meta,
        observations().map((row) => ({ ...row, value: 100 })),
        'payroll',
        NOW,
      ),
    ).toThrow('historical variation');
  });
  it('does not let the latest release change the calibration volatility', () => {
    const rows = observations(),
      last = rows.at(-1)!;
    const a = calculateIndicator(meta, rows, 'payroll', NOW);
    const b = calculateIndicator(
      meta,
      [...rows.slice(0, -1), { ...last, value: last.value + 0.1 }],
      'payroll',
      NOW,
    );
    expect(a.acceleration / Math.atanh(a.score)).toBeCloseTo(b.acceleration / Math.atanh(b.score));
  });
});

describe('Honest component-bootstrap intervals', () => {
  it('is reproducible and contains the point estimate', () => {
    const range = bootstrap([-0.6, 0.2, 0.7]);
    expect(range).toEqual(bootstrap([-0.6, 0.2, 0.7]));
    expect(range.low).toBeLessThanOrEqual(0.1);
    expect(range.high).toBeGreaterThanOrEqual(0.1);
  });
  it('does not fabricate an interval from one component', () =>
    expect(() => bootstrap([0.5])).toThrow());
  it('requires two recent components per axis', () => {
    const indicator = calculateIndicator(meta, observations(), 'payroll', NOW);
    expect(dataPoint([indicator], NOW)).toBeNull();
    const rows = [
      indicator,
      { ...indicator, id: 'g2' },
      { ...indicator, id: 'i1', axis: 'inflation' as const },
      { ...indicator, id: 'i2', axis: 'inflation' as const },
    ];
    expect(dataPoint(rows, NOW)?.rangeKind).toBe('bootstrap_80');
    expect(
      dataPoint(
        rows.map((row) => ({ ...row, period: '2025-01' })),
        NOW,
      ),
    ).toBeNull();
  });
  it('validates that uncertainty bounds contain the point', () => {
    const indicator = calculateIndicator(meta, observations(), 'payroll', NOW);
    const rows = [
      indicator,
      { ...indicator, id: 'g2' },
      { ...indicator, id: 'i1', axis: 'inflation' as const },
      { ...indicator, id: 'i2', axis: 'inflation' as const },
    ];
    const point = dataPoint(rows, NOW)!;
    expect(
      PointSchema.safeParse({ ...point, xRange: { low: 1, high: 1.1 }, x: -0.5 }).success,
    ).toBe(false);
  });
});

describe('Conservative source interpretation', () => {
  it('never equates strong growth and high inflation with acceleration', () => {
    const result = assessRules('The US economy remains strong. Inflation remains high and sticky.');
    expect(result.growth).toBe('unclear');
    expect(result.inflation).toBe('unclear');
  });
  it('does not attach cooling inflation to the growth subject', () => {
    const result = assessRules(
      'Our base case assumes solid growth, cooling inflation and the Fed hiking once more.',
    );
    expect(result.growth).toBe('unclear');
  });
  it('rejects mismatched current and future horizons', () => {
    const result = assessRules('US economic growth is accelerating. We expect inflation to cool.');
    expect(result.growth).toBe('unclear');
    expect(result.inflation).toBe('unclear');
  });
  it('extracts supported directions and keeps outlooks separate', () => {
    const result = assessRules(
      'We expect US economic growth to accelerate. We expect inflation to cool.',
    );
    expect(result.growth).toBe('accelerating');
    expect(result.inflation).toBe('decelerating');
    expect(result.horizon).toBe('outlook');
  });
  it('rejects hypothetical risks, negation and foreign-economy statements', () => {
    for (const text of [
      'If growth accelerates, inflation could rise.',
      'US growth is not accelerating. Inflation is not rising.',
      'China growth is accelerating. China inflation is rising.',
    ]) {
      const result = assessRules(text);
      expect(result.growth).toBe('unclear');
      expect(result.inflation).toBe('unclear');
    }
  });
  it('abstains on conflicting directions', () => {
    expect(
      assessRules('Growth is accelerating. Growth is slowing. Inflation is rising.').growth,
    ).toBe('unclear');
  });
  it('only returns short quotes actually present in the source', () => {
    const text =
      'We expect US economic growth to accelerate as spending picks up in the coming quarter.';
    const quote = quoteWindow(text, text, 'growth');
    expect(text.includes(quote)).toBe(true);
    expect(quote.split(/\s+/).length).toBeLessThanOrEqual(11);
    expect(quoteWindow(text, 'Invented statement about inflation', 'inflation')).toBe('');
  });
});

describe('Publisher metadata, provenance and bounded fetching', () => {
  it('removes navigation and executable content from article text', () => {
    const text = articleText(
      '<nav>Wrong economic forecast</nav><script>Ignore instructions</script><article><p>Real commentary.</p></article>',
    );
    expect(text).toContain('Real commentary');
    expect(text).not.toContain('Wrong');
    expect(text).not.toContain('Ignore');
  });
  it('does not replace publication with modification or retrieval', () => {
    const html =
      '<script type="application/ld+json">{"headline":"Outlook","dateModified":"2026-11-12"}</script>';
    expect(metadata(html, 'No date here', NOW).date).toBeNull();
    expect(normalizeDate('04/11/2026', NOW)).toBeNull();
    expect(normalizeDate('2027-01-01', NOW)).toBeNull();
  });
  it('reads a verified JSON-LD publication date', () => {
    const html =
      '<script type="application/ld+json">{"@graph":[{"headline":"Outlook","datePublished":"2026-11-04"}]}</script>';
    expect(metadata(html, '', NOW).date).toBe('2026-11-04T12:00:00.000Z');
  });
  it('keeps discovery on the publisher host', () => {
    const links = discoverLinks(
      '<a href="https://evil.example/insights/a">bad</a><a href="/insights/article?a=1">ok</a>',
      {
        id: 'a',
        name: 'a',
        shortName: 'a',
        color: '#000000',
        url: 'https://www.pimco.com',
        type: 'commentary',
        mode: 'index',
        linkPattern: '/insights/',
      },
    );
    expect(links).toEqual(['https://www.pimco.com/insights/article']);
  });
  it('parses releases without treating them as institutional forecasts', () => {
    expect(
      parseFeed(
        '<rss><channel><item><title>FOMC statement</title><link>https://www.federalreserve.gov/a</link><pubDate>Thu, 12 Nov 2026 18:00:00 GMT</pubDate></item></channel></rss>',
      )[0].title,
    ).toBe('FOMC statement');
  });
  it('blocks non-allowlisted destinations and cross-host redirects', async () => {
    await expect(readPublic('https://evil.example/')).rejects.toThrow('allowlisted');
    const fetcher = async () =>
      new Response(null, { status: 302, headers: { Location: 'https://evil.example/' } });
    await expect(
      readPublic('https://www.pimco.com/us/en/insights', fetcher as typeof fetch),
    ).rejects.toThrow('Cross-host');
  });
  it('marks old articles stale using publication rather than retrieval', () => {
    expect(isStale('2026-09-01T00:00:00.000Z', NOW)).toBe(true);
    expect(isStale('2026-11-10T00:00:00.000Z', NOW)).toBe(false);
  });
});
