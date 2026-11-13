import { readFileSync } from 'node:fs';
import { Parser } from 'htmlparser2';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Chart from '../frontend/Chart';
import { arrowSegment, outlookPath } from '../shared/outlookPaths';
import { SnapshotSchema, type Point } from '../shared/schema';

const snapshot = SnapshotSchema.parse(JSON.parse(readFileSync('data/latest.json', 'utf8')));
const data = snapshot.points.find((p) => p.kind === 'data')!;
const bank = snapshot.points.find((p) => p.shortName === 'U.S. Bank')!;
const pnc = snapshot.points.find((p) => p.shortName === 'PNC')!;
const ing = snapshot.points.find((p) => p.shortName === 'ING')!;
const render = (
  selectedId = data.id,
  showOutlooks = true,
  outlookMode: 'focused' | 'all' = 'focused',
  points = snapshot.points,
) =>
  renderToStaticMarkup(
    <Chart
      points={points}
      selectedId={selectedId}
      onSelect={() => {}}
      showRanges
      showLabels
      showOutlooks={showOutlooks}
      outlookMode={outlookMode}
    />,
  );

describe('Arrows require the house’s own two-axis forward guidance', () => {
  it('uses U.S. Bank’s 2026 and 2027 forecasts, independently of the hard-data anchor', () => {
    const path = outlookPath(bank)!;
    expect(path.from).toMatchObject({ period: '2026-Q4', x: 0.5 });
    expect(path.from.y).toBeCloseTo(1.2);
    expect(path.to.x).toBeCloseTo(0);
    expect(path.to.y).toBeCloseTo(0.5);
    expect(path.dx).toBeCloseTo(-0.5);
    expect(path.dy).toBeCloseTo(-0.7);
    expect(path.point).toBe(bank);
    expect(path.from.x).not.toBe(data.x);
  });
  it('can end at the plotted house forecast when the earlier endpoint is also sourced', () => {
    const path = outlookPath(pnc)!;
    expect(path.to.x).toBeCloseTo(pnc.x);
    expect(path.to.y).toBeCloseTo(pnc.y);
    expect(path.from.period).toBe('2026-Q4');
    expect(path.to.period).toBe('2027-Q4');
  });
  it('never manufactures a trajectory from a forward-looking label or partial direction', () => {
    for (const name of ['ING', 'PIMCO', 'Vanguard', 'BlackRock'])
      expect(outlookPath(snapshot.points.find((p) => p.shortName === name)!)).toBeNull();
    expect(outlookPath({ ...bank, forwardGuidance: undefined })).toBeNull();
    expect(outlookPath({ ...bank, guidanceReviewVersion: undefined })).toBeNull();
    expect(outlookPath(data)).toBeNull();
  });
  it('requires an anchored point, published axes and ordered comparable periods', () => {
    expect(outlookPath({ ...bank, x: 1 })).toBeNull();
    expect(outlookPath({ ...bank, growthBasis: 'inferred' })).toBeNull();
    expect(outlookPath({ ...bank, axisMode: 'momentum' })).toBeNull();
    const g = bank.forwardGuidance!;
    expect(
      outlookPath({ ...bank, forwardGuidance: { ...g, to: { ...g.to, period: '2025-Q4' } } }),
    ).toBeNull();
    expect(
      outlookPath({ ...bank, forwardGuidance: { ...g, to: { ...g.to, period: '2027' } } }),
    ).toBeNull();
  });
  it('preserves a diagonal direction and leaves space for endpoint markers', () => {
    const from = { x: 700, y: 200 },
      to = { x: 300, y: 400 },
      line = arrowSegment(from, to)!;
    expect(line.x2).toBeLessThan(line.x1);
    expect(line.y2).toBeGreaterThan(line.y1);
    expect((line.y2 - line.y1) / (line.x2 - line.x1)).toBeCloseTo(-0.5);
    expect(Math.hypot(line.x1 - from.x, line.y1 - from.y)).toBeCloseTo(10);
    expect(arrowSegment(from, from)).toBeNull();
    expect(arrowSegment(from, { x: 701, y: 200 })).toBeNull();
  });
  it('draws only qualifying guidance, supports focus/all/hidden, and never starts at hard data', () => {
    const eligible = snapshot.points.filter((p) => outlookPath(p)).length;
    expect(eligible).toBe(2);
    expect(render().match(/class="outlook-path"/g)).toHaveLength(eligible);
    expect(render(bank.id).match(/class="outlook-path"/g)).toHaveLength(1);
    expect(render(ing.id)).not.toContain('class="outlook-path"');
    expect(render(ing.id, true, 'all').match(/class="outlook-path"/g)).toHaveLength(eligible);
    expect(render(bank.id, false)).not.toContain('class="outlook-path"');
    expect(render()).not.toContain('Current data reference to');
    expect(render()).toContain('published forward guidance');
  });
  it('points left and up when a published two-axis endpoint approaches stagflation', () => {
    const point: Point = {
      ...bank,
      id: 'stagflation-guidance',
      forwardGuidance: {
        ...bank.forwardGuidance!,
        to: { period: '2027-Q4', growthRate: 1.5, coreInflationRate: 3.8 },
      },
    };
    const svg = render(point.id, true, 'focused', [data, point]);
    let shaft = '',
      head = '';
    new Parser({
      onopentag(name, a) {
        if (name === 'path' && a.class === 'outlook-shaft') shaft = a.d;
        if (name === 'path' && a.class === 'outlook-arrowhead') head = a.d;
      },
    }).end(svg);
    const [x1, y1, x2, y2] = shaft.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    expect(x2).toBeLessThan(x1);
    expect(y2).toBeLessThan(y1);
    expect(
      head
        .match(/-?\d+(?:\.\d+)?/g)!
        .map(Number)
        .slice(2, 4),
    ).toEqual([x2, y2]);
    expect(svg).toContain('data-to-x="-0.5"');
    expect(svg).toContain('class="guidance-endpoint"');
  });
});
