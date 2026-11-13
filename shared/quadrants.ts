import { regime, type Point } from './schema';

export function reportedAlternatives(point: Point) {
  if (point.kind !== 'institution' || point.scenarioReviewVersion !== 'source-scenarios-v1')
    return [];
  return (point.reportedScenarios || []).filter((s) => s.quadrant !== regime(point.x, point.y));
}

const EPSILON = 1e-9;
export const QUADRANTS = [
  { name: 'Overheating', x: 1, y: 1 },
  { name: 'Stagflation', x: -1, y: 1 },
  { name: 'Goldilocks', x: 1, y: -1 },
  { name: 'Disinflationary slowdown', x: -1, y: -1 },
];

/** Use exact signs for clipping; the UI's near-boundary label cannot authorize a crossing. */
export function allowedRangeQuadrants(point: Point): string[] {
  const primary = QUADRANTS.find((q) => q.x * point.x > EPSILON && q.y * point.y > EPSILON)?.name;
  return [
    ...new Set([
      ...(primary ? [primary] : []),
      ...reportedAlternatives(point).map((s) => s.quadrant),
    ]),
  ];
}

export function interpretationEstimate(point: Point): NonNullable<Point['rangeEstimate']> {
  if (point.rangeEstimate) return point.rangeEstimate;
  const width = (axis: 'growth' | 'inflation') => {
    const center = axis === 'growth' ? point.x : point.y;
    const bounds = axis === 'growth' ? point.xRange : point.yRange;
    const oldWidth = Math.max(center - bounds.low, bounds.high - center);
    if (point.rangeKind === 'model_range' && oldWidth > EPSILON)
      return Math.min(3, Math.max(0.05, oldWidth));
    return point[axis === 'growth' ? 'growthBasis' : 'inflationBasis'] === 'direct'
      ? 0.4
      : point.confidence === 'low'
        ? 0.9
        : 0.75;
  };
  return {
    growthRadius: width('growth'),
    inflationRadius: width('inflation'),
    rationale:
      'Interpretive half-widths in percentage points. Explicit rates use narrower assumptions than qualitative mappings. These are not calibrated confidence intervals; cross-quadrant permission comes only from verified report scenarios.',
  };
}

/** E ∩ union(authorized quadrants), preserving the original ellipse center and radii. */
export function constrainedRange(point: Point) {
  const estimate = interpretationEstimate(point);
  const { growthRadius: rx, inflationRadius: ry } = estimate;
  const cx = point.x,
    cy = point.y;
  const allowed = allowedRangeQuadrants(point);
  const slices = QUADRANTS.filter((q) => allowed.includes(q.name)).flatMap((q) => {
    const nearX = q.x * cx >= 0 ? cx : 0,
      nearY = q.y * cy >= 0 ? cy : 0;
    const distance = ((nearX - cx) / rx) ** 2 + ((nearY - cy) / ry) ** 2;
    if (distance >= 1 - EPSILON) return [];
    const dx = rx * Math.sqrt(Math.max(0, 1 - ((nearY - cy) / ry) ** 2));
    const dy = ry * Math.sqrt(Math.max(0, 1 - ((nearX - cx) / rx) ** 2));
    const xRange = {
      low: Math.max(-3, cx - dx, q.x > 0 ? 0 : -Infinity),
      high: Math.min(3, cx + dx, q.x < 0 ? 0 : Infinity),
    };
    const yRange = {
      low: Math.max(-3, cy - dy, q.y > 0 ? 0 : -Infinity),
      high: Math.min(3, cy + dy, q.y < 0 ? 0 : Infinity),
    };
    if (xRange.high - xRange.low <= EPSILON || yRange.high - yRange.low <= EPSILON) return [];
    return [{ quadrant: q.name, xRange, yRange }];
  });
  return {
    estimate,
    allowed,
    slices,
    xRange: {
      low: Math.min(cx, ...slices.map((s) => s.xRange.low)),
      high: Math.max(cx, ...slices.map((s) => s.xRange.high)),
    },
    yRange: {
      low: Math.min(cy, ...slices.map((s) => s.yRange.low)),
      high: Math.max(cy, ...slices.map((s) => s.yRange.high)),
    },
  };
}

export function withInterpretationRange(point: Point): Point {
  if (point.kind === 'data') return point;
  const range = constrainedRange(point);
  return {
    ...point,
    rangeKind: 'model_range',
    rangePolicy: 'quadrant-constrained-v1',
    rangeEstimate: range.estimate,
    xRange: range.xRange,
    yRange: range.yRange,
  };
}

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
