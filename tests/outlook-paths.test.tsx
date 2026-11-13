import { readFileSync } from 'node:fs';
import { Parser } from 'htmlparser2';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Chart from '../frontend/Chart';
import { arrowSegment, outlookPath } from '../shared/outlookPaths';
import { SnapshotSchema, type Point } from '../shared/schema';

const snapshot = SnapshotSchema.parse(JSON.parse(readFileSync('data/latest.json', 'utf8')));
const data = snapshot.points.find((p) => p.kind === 'data')!;
const ing = snapshot.points.find((p) => p.shortName === 'ING')!;
const vanguard = snapshot.points.find((p) => p.shortName === 'Vanguard')!;
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

describe('Outlook paths use both coordinates at the plotted horizon', () => {
  it('points ING left and down relative to the reference, without inventing a new endpoint', () => {
    const path = outlookPath(ing, data)!;
    expect(path.dx).toBeCloseTo(-1.2);
    expect(path.dy).toBeCloseTo(-0.4);
    expect(path.to).toBe(ing);
    expect(path.from).toBe(data);
    expect(path.inferred).toBe(true);
  });

  it('keeps Vanguard’s year-end arrow upward despite its later disinflation statement', () => {
    expect(vanguard.outlookDirection?.inflation).toBe('falling');
    const path = outlookPath(vanguard, data)!;
    expect(path.dx).toBeLessThan(0);
    expect(path.dy).toBeCloseTo(0.1);
    expect(path.to.horizonLabel).toContain('2026');
  });

  it('requires a two-axis forecast, common units and a data reference', () => {
    expect(outlookPath(ing)).toBeNull();
    expect(outlookPath({ ...ing, horizon: 'current' }, data)).toBeNull();
    expect(outlookPath({ ...ing, growthBasis: 'unclear' }, data)).toBeNull();
    expect(outlookPath({ ...ing, axisMode: 'momentum' }, data)).toBeNull();
    expect(outlookPath({ ...ing, inflationBenchmark: 3 }, data)).toBeNull();
    expect(outlookPath(ing, ing)).toBeNull();
    expect(
      outlookPath({ ...ing, growthBasis: 'direct', inflationBasis: 'direct' }, data)?.inferred,
    ).toBe(false);
  });

  it('preserves a diagonal direction and leaves space for both endpoint markers', () => {
    const from = { x: 700, y: 200 },
      to = { x: 300, y: 400 };
    const line = arrowSegment(from, to)!;
    expect(line.x2).toBeLessThan(line.x1);
    expect(line.y2).toBeGreaterThan(line.y1);
    expect((line.y2 - line.y1) / (line.x2 - line.x1)).toBeCloseTo(-0.5);
    expect(Math.hypot(line.x1 - from.x, line.y1 - from.y)).toBeCloseTo(10);
    expect(Math.hypot(line.x2 - to.x, line.y2 - to.y)).toBeCloseTo(10);
    expect(arrowSegment(from, from)).toBeNull();
    expect(arrowSegment(from, { x: 701, y: 200 })).toBeNull();
  });

  it('draws eligible reference-to-outlook paths, focuses one, and can hide them', () => {
    const eligible = snapshot.points.filter((p) => outlookPath(p, data)).length;
    expect(render().match(/class="outlook-path"/g) || []).toHaveLength(eligible);
    expect(render(ing.id).match(/class="outlook-path"/g) || []).toHaveLength(1);
    expect(render(ing.id, true, 'all').match(/class="outlook-path"/g) || []).toHaveLength(eligible);
    expect(render(ing.id, false)).not.toContain('class="outlook-path"');
    const current = snapshot.points.find(
      (p) => p.kind === 'institution' && p.horizon === 'current',
    )!;
    expect(render(current.id)).not.toContain('class="outlook-path"');
    expect(render()).not.toContain('class="outlook-arrow"');
    expect(render()).toContain('Dashed: endpoint includes our interpretation');
  });

  it('renders an arrow to a Stagflation endpoint using the SVG axes, rather than an up/down glyph', () => {
    const stagflation: Point = {
      ...ing,
      id: 'stagflation-test',
      x: -0.5,
      y: 1.8,
      xRange: { low: -0.8, high: -0.2 },
      yRange: { low: 1.4, high: 2.2 },
    };
    const svg = render(stagflation.id, true, 'focused', [data, stagflation]);
    let shaft = '',
      head = '';
    new Parser({
      onopentag(name, attrs) {
        if (name === 'path' && attrs.class === 'outlook-shaft') shaft = attrs.d;
        if (name === 'path' && attrs.class === 'outlook-arrowhead') head = attrs.d;
      },
    }).end(svg);
    const [x1, y1, x2, y2] = shaft.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    // Negative x points left; higher inflation has a smaller SVG y.
    expect(x2).toBeLessThan(x1);
    expect(y2).toBeLessThan(y1);
    const vertices = head.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    expect(vertices.slice(2, 4)).toEqual([x2, y2]);
    expect(svg).toContain('data-to-x="-0.5"');
    expect(svg).toContain('data-to-y="1.8"');
  });
});
