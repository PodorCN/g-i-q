import { readFileSync } from 'node:fs';
import { Parser } from 'htmlparser2';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Chart from '../frontend/Chart';
import { fitAxis } from '../frontend/chartScale';
import { SnapshotSchema } from '../shared/schema';

describe('Chart bounds follow the data and complete uncertainty ranges', () => {
  it('pads extreme values on either side and retains both sides of zero', () => {
    for (const values of [
      [1.45, 0.85, 2.05],
      [3.4, 2.8, 4.6],
      [-4.2, -5, -3.3],
    ]) {
      const axis = fitAxis(values);
      expect(axis.min).toBeLessThan(Math.min(0, ...values));
      expect(axis.max).toBeGreaterThan(Math.max(0, ...values));
      expect(axis.ticks).toContain(0);
      expect(axis.ticks.every(Number.isFinite)).toBe(true);
    }
  });

  it('provides a nonzero plot extent for empty and boundary-only filters', () => {
    for (const values of [[], [0, 0]]) {
      const axis = fitAxis(values);
      expect(axis.min).toBeLessThan(0);
      expect(axis.max).toBeGreaterThan(0);
      expect(axis.ticks.length).toBeGreaterThan(2);
    }
  });

  it('keeps rendered ellipses inside the clipping frame, including an outlying data point', () => {
    const snapshot = SnapshotSchema.parse(JSON.parse(readFileSync('data/latest.json', 'utf8')));
    const points = snapshot.points.map((p) =>
      p.kind === 'data'
        ? {
            ...p,
            x: 3.4,
            y: -3.5,
            xRange: { low: 2.8, high: 4.6 },
            yRange: { low: -4.2, high: -2.8 },
          }
        : p,
    );
    const markup = renderToStaticMarkup(
      <Chart points={points} selectedId="hard-data" onSelect={() => {}} showRanges showLabels />,
    );
    let frame: Record<string, number> | undefined;
    const ellipses: Record<string, number>[] = [];
    const parser = new Parser({
      onopentag(name, attrs) {
        if (name === 'rect' && !frame)
          frame = Object.fromEntries(
            Object.entries(attrs).map(([key, value]) => [key, Number(value)]),
          );
        if (name === 'ellipse')
          ellipses.push(
            Object.fromEntries(Object.entries(attrs).map(([key, value]) => [key, Number(value)])),
          );
      },
    });
    parser.end(markup);
    expect(ellipses).toHaveLength(points.length);
    for (const e of ellipses) {
      expect(e.cx - e.rx).toBeGreaterThan(frame!.x + 5);
      expect(e.cx + e.rx).toBeLessThan(frame!.x + frame!.width - 5);
      expect(e.cy - e.ry).toBeGreaterThan(frame!.y + 5);
      expect(e.cy + e.ry).toBeLessThan(frame!.y + frame!.height - 5);
    }
  });
});
