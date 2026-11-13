import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { Parser } from 'htmlparser2';
import { describe, expect, it } from 'vitest';
import { constrainedRange, withInterpretationRange } from '../shared/quadrants';
import { SnapshotSchema, type Point, type ReportedScenario } from '../shared/schema';
import Chart from '../frontend/Chart';

const snapshot = SnapshotSchema.parse(JSON.parse(readFileSync('data/latest.json', 'utf8')));
const base: Point = {
  ...snapshot.points.find((p) => p.kind === 'institution')!,
  x: 0.2,
  y: 0.2,
  reportedScenarios: [],
  scenarioReviewVersion: 'source-scenarios-v1',
  rangeEstimate: { growthRadius: 1, inflationRadius: 1, rationale: 'Test interpretive width.' },
};
const scenario = (quadrant: ReportedScenario['quadrant']): ReportedScenario => ({
  quadrant,
  growthQuote: 'Fixture: explicit growth scenario.',
  inflationQuote: 'Fixture: explicit inflation scenario.',
  horizonLabel: 'Test scenario',
});
const quadrants = (point: Point) => constrainedRange(point).slices.map((s) => s.quadrant);
const markup = (point: Point) =>
  renderToStaticMarkup(
    <Chart points={[point]} selectedId={point.id} onSelect={() => {}} showRanges showLabels />,
  );

describe('Interpretive ranges obey exact quadrant permissions', () => {
  it('allows a broad within-quadrant range without source alternatives', () => {
    const r = constrainedRange(base);
    expect(quadrants(base)).toEqual(['Overheating']);
    expect(r.xRange).toEqual({ low: 0, high: 1.2 });
    expect(r.yRange).toEqual({ low: 0, high: 1.2 });
    expect(r.estimate.growthRadius).toBe(1);
  });
  it('allows only Stagflation when that is the one explicitly supported alternative', () => {
    const point = { ...base, reportedScenarios: [scenario('Stagflation')] };
    expect(quadrants(point)).toEqual(['Overheating', 'Stagflation']);
    expect(constrainedRange(point).xRange.low).toBeCloseTo(-0.8);
    expect(constrainedRange(point).yRange.low).toBe(0);
  });
  it('does not leak into the fourth quadrant when two alternatives permit both axis crossings', () => {
    const point = { ...base, reportedScenarios: [scenario('Stagflation'), scenario('Goldilocks')] };
    const r = constrainedRange(point);
    expect(r.xRange.low).toBeLessThan(0);
    expect(r.yRange.low).toBeLessThan(0);
    expect(quadrants(point)).toEqual(['Overheating', 'Stagflation', 'Goldilocks']);
    const svg = markup(point);
    expect(svg).not.toContain('data-range-quadrant="Disinflationary slowdown"');
    expect(svg.match(/data-range-quadrant=/g)).toHaveLength(3);
  });
  it('supports disjoint authorized quadrants without adding intermediate regimes', () => {
    const point = { ...base, reportedScenarios: [scenario('Disinflationary slowdown')] };
    expect(quadrants(point)).toEqual(['Overheating', 'Disinflationary slowdown']);
  });
  it('preserves the original ellipse center and radius rather than reshaping clipped marginal bounds', () => {
    const point = withInterpretationRange(base);
    expect(point.xRange.low).toBe(0);
    let ellipse: Record<string, string> = {},
      clipRect: Record<string, string> = {},
      circle: Record<string, string> = {};
    new Parser({
      onopentag(name, a) {
        if (name === 'ellipse') ellipse = a;
        if (name === 'rect' && a['data-range-quadrant'] === 'Overheating') clipRect = a;
        if (name === 'circle' && a.r === '6.5') circle = a;
      },
    }).end(markup(point));
    expect(Number(ellipse.cx)).toBeCloseTo(Number(circle.cx));
    expect(Number(ellipse.cy)).toBeCloseTo(Number(circle.cy));
    expect(Number(ellipse.cx) - Number(ellipse.rx)).toBeLessThan(Number(clipRect.x));
    expect(Number(ellipse.cy) + Number(ellipse.ry)).toBeGreaterThan(
      Number(clipRect.y) + Number(clipRect.height),
    );
    expect(markup(point)).toMatch(/class="interpretation-range"[^>]*clip-path="url\(#[^)]+\)"/);
  });
  it('does not mistake a near-axis center or mere boundary touch for permission to cross', () => {
    expect(quadrants({ ...base, x: 0.01 })).toEqual(['Overheating']);
    expect(quadrants({ ...base, x: 1, reportedScenarios: [scenario('Stagflation')] })).toEqual([
      'Overheating',
    ]);
    expect(quadrants({ ...base, x: 0 })).toEqual([]);
  });
  it('ignores unreviewed scenario permissions and applies the same constraint to cached widths', () => {
    const p = {
      ...base,
      rangeEstimate: undefined,
      rangeKind: 'model_range' as const,
      xRange: { low: -3, high: 3 },
      yRange: { low: -3, high: 3 },
      reportedScenarios: [scenario('Stagflation')],
      scenarioReviewVersion: undefined,
    };
    expect(quadrants(p)).toEqual(['Overheating']);
    expect(withInterpretationRange(p).xRange.low).toBe(0);
  });
  it('constrains the live snapshot while preserving every center, source and published guidance', () => {
    const houses = snapshot.points.filter((p) => p.kind === 'institution');
    expect(houses).toHaveLength(20);
    for (const p of houses) {
      const r = constrainedRange(p);
      expect(p.xRange).toEqual(r.xRange);
      expect(p.yRange).toEqual(r.yRange);
      expect(r.slices.every((s) => r.allowed.includes(s.quadrant))).toBe(true);
      expect(p.xRange.low).toBeLessThanOrEqual(p.x);
      expect(p.xRange.high).toBeGreaterThanOrEqual(p.x);
      expect(r.slices.length > 0).toBe(true);
      if (p.shortName !== 'ING') expect(r.slices).toHaveLength(1);
    }
    expect(houses.filter((p) => p.forwardGuidance).map((p) => p.shortName)).toEqual([
      'U.S. Bank',
      'PNC',
    ]);
  });
});
