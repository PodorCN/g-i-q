import type { Point } from './schema';

const EPSILON = 1e-9;
const QUADRANTS = [
  { name: 'Overheating', x: 1, y: 1 },
  { name: 'Stagflation', x: -1, y: 1 },
  { name: 'Goldilocks', x: 1, y: -1 },
  { name: 'Disinflationary slowdown', x: -1, y: -1 },
];

/** Actual ellipse intersections, not its rectangular bounding box or probabilities. */
export function rangeQuadrants(point: Pick<Point, 'xRange' | 'yRange' | 'rangeKind'>): string[] {
  const cx = (point.xRange.low + point.xRange.high) / 2;
  const cy = (point.yRange.low + point.yRange.high) / 2;
  const rx = (point.xRange.high - point.xRange.low) / 2;
  const ry = (point.yRange.high - point.yRange.low) / 2;
  return QUADRANTS.filter((q) => {
    const extentX = q.x > 0 ? point.xRange.high : -point.xRange.low;
    const extentY = q.y > 0 ? point.yRange.high : -point.yRange.low;
    if (extentX <= EPSILON || extentY <= EPSILON) return false;
    if (point.rangeKind !== 'model_range') return true;
    const dx = Math.max(0, -q.x * cx),
      dy = Math.max(0, -q.y * cy);
    const distance = (rx > EPSILON ? (dx / rx) ** 2 : 0) + (ry > EPSILON ? (dy / ry) ** 2 : 0);
    return distance < 1 - EPSILON;
  }).map((q) => q.name);
}

export function outlookVector(point: Point): { x: number; y: number } | null {
  const outlook = point.outlookDirection;
  if (point.kind !== 'institution' || !outlook) return null;
  const sign = (direction: string) =>
    direction === 'rising' ? 1 : direction === 'falling' ? -1 : 0;
  const x = sign(outlook.growth),
    y = sign(outlook.inflation);
  return x || y ? { x, y } : null;
}
