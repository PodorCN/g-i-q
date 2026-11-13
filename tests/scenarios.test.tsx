import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../backend/collect';
import { sourceOnlyRanges, verifiedScenarios } from '../backend/scenarios';
import Chart from '../frontend/Chart';
import { reportedAlternatives } from '../shared/quadrants';
import { axisSupport, SnapshotSchema, type ReportedScenario } from '../shared/schema';

const snapshot = SnapshotSchema.parse(JSON.parse(readFileSync('data/latest.json', 'utf8')));
const data = snapshot.points.find((p) => p.kind === 'data')!;
const house = {
  ...snapshot.points.find((p) => p.shortName === 'Vanguard')!,
  reportedScenarios: [],
};
const scenario: ReportedScenario = {
  quadrant: 'Stagflation',
  growthQuote: 'In our downside scenario, recession risks would increase.',
  inflationQuote: 'In that same scenario, inflation would remain above target.',
  horizonLabel: 'Conditional downside; next year',
};
const text = scenario.growthQuote + ' ' + scenario.inflationQuote;
const render = (point = house) =>
  renderToStaticMarkup(
    <Chart
      points={[data, point]}
      selectedId={point.id}
      onSelect={() => {}}
      showRanges
      showLabels
      rangeMode="selected"
    />,
  );

describe('Only report-backed scenarios can extend a house view', () => {
  it('never displays a legacy mapper ellipse, even if its widths cover all four quadrants', () => {
    const old = {
      ...house,
      rangeKind: 'model_range' as const,
      xRange: { low: -3, high: 3 },
      yRange: { low: -3, high: 3 },
    };
    const svg = render(old);
    expect(svg).not.toContain('<ellipse');
    expect(svg).not.toContain('reported-scenario-region');
    expect(reportedAlternatives(old)).toEqual([]);
  });
  it('normalizes cached house ranges without collapsing the separate data sensitivity range', () => {
    const old = { ...house, rangeKind: 'model_range' as const, xRange: { low: -3, high: 3 } };
    expect(sourceOnlyRanges(old)).toMatchObject({
      rangeKind: 'none',
      xRange: { low: old.x, high: old.x },
    });
    expect(sourceOnlyRanges(data)).toBe(data);
  });
  it('accepts a sourced two-axis conditional risk and preserves its horizon', () => {
    expect(verifiedScenarios(text, [scenario], house)).toMatchObject([
      { quadrant: 'Stagflation', horizonLabel: scenario.horizonLabel },
    ]);
  });
  it('preserves percentage units at the end of a quoted scenario', () => {
    const inflationQuote = 'In that scenario, rising inflation could push interest rates above 5%.';
    const candidate = { ...scenario, inflationQuote };
    expect(
      verifiedScenarios(scenario.growthQuote + ' ' + inflationQuote, [candidate], house)[0]
        .inflationQuote,
    ).toBe(inflationQuote);
  });
  it('does not borrow a year from an unrelated baseline paragraph for a risk scenario', () => {
    const candidate = { ...scenario, horizonLabel: '2027' };
    expect(
      verifiedScenarios('Our 2027 baseline is strong. ' + text, [candidate], house)[0].horizonLabel,
    ).toContain('timing not verified');
  });
  it('retains an explicitly possible regime in cannot-rule-out wording', () => {
    const quote = 'We cannot rule out a U.S. stagflation scenario next year.';
    const candidate = { ...scenario, growthQuote: quote, inflationQuote: quote };
    expect(verifiedScenarios(quote, [candidate], house)).toHaveLength(1);
  });
  it('rejects invented evidence, a one-axis recession risk, and an unspecified inflation outcome', () => {
    expect(verifiedScenarios('Our growth base case remains firm.', [scenario], house)).toEqual([]);
    const risk = { ...scenario, inflationQuote: 'The inflation outcome is uncertain.' };
    expect(verifiedScenarios(risk.growthQuote + ' ' + risk.inflationQuote, [risk], house)).toEqual(
      [],
    );
  });
  it('rejects negated and third-party scenarios even when the model crops away the qualifier', () => {
    const candidate = {
      ...scenario,
      growthQuote: 'recession risks would increase',
      inflationQuote: 'inflation would remain above target',
    };
    expect(
      verifiedScenarios(
        'We do not believe recession risks would increase. Inflation would remain above target.',
        [candidate],
        house,
      ),
    ).toEqual([]);
    expect(
      verifiedScenarios(
        'The Fed said recession risks would increase. Inflation would remain above target.',
        [candidate],
        house,
      ),
    ).toEqual([]);
  });
  it('does not turn falling inflation into below-target inflation or merge distant scenarios', () => {
    const candidate = {
      ...scenario,
      quadrant: 'Disinflationary slowdown' as const,
      inflationQuote: 'Inflation would fall from its elevated level.',
    };
    expect(
      verifiedScenarios(candidate.growthQuote + ' ' + candidate.inflationQuote, [candidate], house),
    ).toEqual([]);
    expect(
      verifiedScenarios(
        scenario.growthQuote + ' Unrelated discussion.'.repeat(120) + scenario.inflationQuote,
        [scenario],
        house,
      ),
    ).toEqual([]);
  });
  it('shades only the named alternative and draws no ellipse bridging unmentioned quadrants', () => {
    const point = {
      ...house,
      reportedScenarios: verifiedScenarios(text, [scenario], house),
      scenarioReviewVersion: 'source-scenarios-v1' as const,
    };
    const svg = renderToStaticMarkup(
      <Chart
        points={[data, point]}
        selectedId={point.id}
        onSelect={() => {}}
        showRanges
        showLabels
        rangeMode="selected"
      />,
    );
    expect(svg.match(/class="reported-scenario-region"/g)).toHaveLength(1);
    expect(svg).toContain('data-quadrant="Stagflation"');
    expect(svg).not.toContain('data-quadrant="Goldilocks"');
    expect(svg).not.toContain('<ellipse');
    expect(svg).toContain('no numeric bounds');
    expect(axisSupport(point, data, 'growth')).toBe('Report includes opposing scenario');
  });
  it('keeps a two-axis scenario through collection while leaving numerical bounds unset', async () => {
    const base = 'We forecast real GDP growth of 2.5%. Core PCE inflation should be 3%.';
    const html = `<article><time datetime="2026-11-13">November 13, 2026</time>${base} ${text} ${'Additional macro research. '.repeat(20)}</article>`;
    const fetcher = (async (input: RequestInfo | URL) =>
      String(input).includes('pimco.com')
        ? new Response(html)
        : new Response('unavailable', { status: 503 })) as typeof fetch;
    const result = await buildSnapshot({
      now: '2026-11-13T21:00:00.000Z',
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
        growthRate: 2.5,
        coreInflationRate: 3,
        growthBasis: 'direct',
        inflationBasis: 'direct',
        growthQuote: 'We forecast real GDP growth of 2.5%.',
        inflationQuote: 'Core PCE inflation should be 3%.',
        horizon: 'outlook',
        confidence: 'medium',
        rationale: 'Test baseline and separately sourced downside.',
        reportedScenarios: [scenario],
      }),
    });
    expect(result.points[0]).toMatchObject({
      rangeKind: 'none',
      xRange: { low: 0.5, high: 0.5 },
      reportedScenarios: [{ quadrant: 'Stagflation' }],
    });
  });
});
