import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { verifiedSnippet } from '../backend/analysis';
import { verifiedOutlook } from '../backend/outlook';
import { rangeQuadrants } from '../shared/quadrants';
import { axisSupport, OutlookDirectionSchema, SnapshotSchema, type Point } from '../shared/schema';

const snapshot = SnapshotSchema.parse(JSON.parse(readFileSync('data/latest.json', 'utf8')));
const data = snapshot.points.find((p) => p.kind === 'data')!;
const house: Point = {
  ...snapshot.points.find((p) => p.kind === 'institution')!,
  outlookDirection: undefined,
  rangeKind: 'model_range',
  reportedScenarios: [],
  x: 0.4,
  y: 0.6,
  xRange: { low: -0.3, high: 1.1 },
  yRange: { low: -0.1, high: 1.3 },
};
const text =
  'Our baseline expects inflation to fall over the next year. Growth remains above trend.';
const assessment = {
  inflationOutlook: 'falling' as const,
  inflationOutlookQuote: 'inflation to fall over the next year',
  outlookHorizon: 'Next year',
};

describe('Data sensitivity geometry and comparison semantics', () => {
  it('checks the ellipse instead of declaring all four quadrants from crossing marginal ranges', () => {
    expect(rangeQuadrants(house)).toEqual(['Overheating', 'Stagflation', 'Goldilocks']);
  });

  it('includes all four only when the ellipse actually enters them', () => {
    expect(
      rangeQuadrants({ ...house, xRange: { low: -1, high: 1 }, yRange: { low: -1, high: 1 } }),
    ).toHaveLength(4);
    expect(rangeQuadrants(data)).toEqual(['Overheating']);
  });

  it('does not treat a boundary touch or floating-point residue as entry', () => {
    const touching = { ...house, xRange: { low: 0, high: 1 }, yRange: { low: -2e-16, high: 1.6 } };
    expect(rangeQuadrants(touching)).toEqual(['Overheating']);
    expect(axisSupport(touching, data, 'inflation')).toBe('Mapped center aligned');
  });

  it('does not use retired mapper widths to manufacture house disagreement', () => {
    expect(axisSupport(house, data, 'growth')).toBe('Mapped center aligned');
    expect(axisSupport(house, data, 'inflation')).toBe('Mapped center aligned');
  });
});

describe('Outlook arrows require evidence and preserve unknown directions', () => {
  it('retains a sourced inflation decline without assuming steady growth', () => {
    const result = verifiedOutlook(text, assessment)!;
    expect(result.growth).toBe('unspecified');
    expect(result.inflation).toBe('falling');
    expect(result.evidence[0].quote).toBe(assessment.inflationOutlookQuote);
  });

  it('rejects invented direction quotations and missing horizons', () => {
    expect(
      verifiedOutlook(text, {
        ...assessment,
        inflationOutlookQuote: 'inflation will rise rapidly',
      }),
    ).toBeUndefined();
    expect(verifiedOutlook(text, { ...assessment, outlookHorizon: '' })).toBeUndefined();
    const partial = verifiedOutlook(text, {
      ...assessment,
      growthOutlook: 'rising',
      growthOutlookQuote: 'We expect faster growth',
    });
    expect(partial?.growth).toBe('unspecified');
    expect(partial?.inflation).toBe('falling');
  });

  it('requires a separate quoted passage for every known axis', () => {
    const result = verifiedOutlook(text, assessment)!;
    expect(OutlookDirectionSchema.safeParse({ ...result, growth: 'steady' }).success).toBe(false);
    expect(OutlookDirectionSchema.safeParse({ ...result, inflation: 'unspecified' }).success).toBe(
      false,
    );
  });

  it('keeps the entire short directional quote, including its verb and qualification', () => {
    const passage =
      'By April 2027, core inflation as measured by the Personal Consumption Expenditures price index should decline from current levels';
    const result = verifiedOutlook(passage, {
      ...assessment,
      inflationOutlookQuote: passage,
      outlookHorizon: 'April 2027',
    });
    expect(result?.evidence[0].quote).toBe(passage);
    expect(result?.horizonLabel).toBe('April 2027');
  });

  it('preserves decimals when extracting a level quotation', () => {
    const passage = 'Our forecast is kind of 2.5% real growth plus minus.';
    expect(verifiedSnippet(passage, passage, 'growth')).toContain('2.5%');
    expect(verifiedSnippet(passage, '5% real growth plus minus', 'growth')).toBe('');
  });
});
