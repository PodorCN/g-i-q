import type { Point } from './schema';

/** Only a house's own sourced, comparable earlier/later forecasts can form a path. */
export function outlookPath(point: Point) {
  const guidance = point.forwardGuidance;
  if (
    point.kind !== 'institution' ||
    point.axisMode !== 'levels' ||
    !guidance ||
    point.guidanceReviewVersion !== 'source-guidance-v1' ||
    point.growthBasis !== 'direct' ||
    point.inflationBasis !== 'direct' ||
    !guidance.growthQuote ||
    !guidance.inflationQuote ||
    !guidance.periodQuote ||
    guidance.to.period <= guidance.from.period ||
    guidance.from.period.length !== guidance.to.period.length
  )
    return null;
  const coordinate = (endpoint: typeof guidance.from) => ({
    ...endpoint,
    x: endpoint.growthRate - (point.growthBenchmark ?? 2),
    y: endpoint.coreInflationRate - (point.inflationBenchmark ?? 2),
  });
  const from = coordinate(guidance.from),
    to = coordinate(guidance.to);
  const matches = (end: typeof from) =>
    Math.abs(point.x - end.x) < 1e-6 && Math.abs(point.y - end.y) < 1e-6;
  // Do not attach a published trajectory to an unrelated interpreted dot.
  if ((!matches(from) && !matches(to)) || (from.x === to.x && from.y === to.y)) return null;
  return {
    point,
    guidance,
    from,
    to,
    dx: to.x - from.x,
    dy: to.y - from.y,
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
