import type { Point } from './schema';

/** A reference-to-forecast comparison, not the house's own current-to-future trajectory. */
export function outlookPath(point: Point, data?: Point) {
  if (
    !data ||
    data.kind !== 'data' ||
    point.kind !== 'institution' ||
    point.horizon !== 'outlook' ||
    point.axisMode !== 'levels' ||
    data.axisMode !== 'levels' ||
    !['direct', 'inferred'].includes(point.growthBasis || '') ||
    !['direct', 'inferred'].includes(point.inflationBasis || '') ||
    (point.growthBenchmark ?? 2) !== (data.growthBenchmark ?? 2) ||
    (point.inflationBenchmark ?? 2) !== (data.inflationBenchmark ?? 2)
  )
    return null;
  return {
    from: data,
    to: point,
    dx: point.x - data.x,
    dy: point.y - data.y,
    inferred: point.growthBasis !== 'direct' || point.inflationBasis !== 'direct',
  };
}

/** Keep endpoints tied to the actual scales; stop just before the destination dot. */
export function arrowSegment(
  from: { x: number; y: number },
  to: { x: number; y: number },
  inset = 10,
) {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length <= 2 * inset) return null;
  const ux = dx / length,
    uy = dy / length;
  return {
    x1: from.x + ux * inset,
    y1: from.y + uy * inset,
    x2: to.x - ux * inset,
    y2: to.y - uy * inset,
    ux,
    uy,
  };
}
