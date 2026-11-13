import { z } from 'zod';

const httpsUrl = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === 'https:', 'Source URLs must use HTTPS');
export const RangeSchema = z
  .object({ low: z.number().min(-3).max(3), high: z.number().min(-3).max(3) })
  .refine((r) => r.low <= r.high, 'Range endpoints must be ordered');
export const EvidenceSchema = z.object({
  axis: z.enum(['growth', 'inflation']),
  quote: z.string().max(240),
  interpretation: z.string(),
});
export const ReportedScenarioSchema = z.object({
  quadrant: z.enum(['Overheating', 'Stagflation', 'Goldilocks', 'Disinflationary slowdown']),
  growthQuote: z.string().min(1).max(240),
  inflationQuote: z.string().min(1).max(240),
  horizonLabel: z.string().min(1).max(160),
});
export const GuidanceEndpointSchema = z.object({
  period: z.string().regex(/^20\d{2}(?:-Q[1-4])?$/),
  growthRate: z.number().min(-10).max(15),
  coreInflationRate: z.number().min(-5).max(15),
});
export const ForwardGuidanceSchema = z
  .object({
    from: GuidanceEndpointSchema,
    to: GuidanceEndpointSchema,
    growthMeasure: z.enum(['real-gdp-q4q4', 'real-gdp-annual-average', 'real-gdp-qoq-annualized']),
    inflationMeasure: z.literal('core-pce-yoy'),
    growthQuote: z.string().min(1).max(240),
    inflationQuote: z.string().min(1).max(240),
    periodQuote: z.string().min(1).max(240),
  })
  .refine(
    (g) => g.from.period.length === g.to.period.length && g.to.period > g.from.period,
    'Guidance needs comparable periods in chronological order',
  );
export const OutlookDirectionSchema = z
  .object({
    growth: z.enum(['rising', 'falling', 'steady', 'unspecified']),
    inflation: z.enum(['rising', 'falling', 'steady', 'unspecified']),
    horizonLabel: z.string().min(1).max(160),
    evidence: z.array(EvidenceSchema).min(1).max(2),
  })
  .superRefine((outlook, ctx) => {
    if (outlook.growth === 'unspecified' && outlook.inflation === 'unspecified')
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'An outlook needs a sourced direction',
      });
    for (const axis of ['growth', 'inflation'] as const) {
      if (
        outlook[axis] !== 'unspecified' &&
        !outlook.evidence.some((e) => e.axis === axis && e.quote.trim().length > 0)
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Each stated direction needs its own quotation',
        });
    }
  });
export const PointSchema = z
  .object({
    id: z.string(),
    institution: z.string(),
    shortName: z.string(),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    kind: z.enum(['institution', 'data']),
    x: z.number().min(-3).max(3),
    y: z.number().min(-3).max(3),
    xRange: RangeSchema,
    yRange: RangeSchema,
    rangeKind: z.enum(['none', 'model_range', 'bootstrap_80']),
    reportedScenarios: z.array(ReportedScenarioSchema).max(3).optional(),
    scenarioReviewVersion: z.literal('source-scenarios-v1').optional(),
    confidence: z.enum(['low', 'medium', 'high']),
    horizon: z.enum(['current', 'outlook']),
    horizonLabel: z.string().optional(),
    outlookDirection: OutlookDirectionSchema.optional(),
    forwardGuidance: ForwardGuidanceSchema.optional(),
    guidanceReviewVersion: z.literal('source-guidance-v1').optional(),
    growthDirection: z.enum(['accelerating', 'decelerating', 'stable', 'unclear']).optional(),
    inflationDirection: z.enum(['accelerating', 'decelerating', 'stable', 'unclear']).optional(),
    growthBasis: z.enum(['direct', 'inferred', 'unclear']).optional(),
    inflationBasis: z.enum(['direct', 'inferred', 'unclear']).optional(),
    maxAgeDays: z.number().min(1).max(180).optional(),
    mappingVersion: z.literal('view-v2').optional(),
    axisMode: z.enum(['momentum', 'levels']).optional(),
    growthRate: z.number().optional(),
    inflationRate: z.number().optional(),
    growthBenchmark: z.number().optional(),
    inflationBenchmark: z.number().optional(),
    publishedAt: z.string().datetime(),
    datePrecision: z.enum(['month']).optional(),
    retrievedAt: z.string().datetime(),
    sourceUrl: httpsUrl,
    title: z.string(),
    summary: z.string(),
    evidence: z.array(EvidenceSchema),
    method: z.enum(['rules', 'llm', 'data', 'reviewed']),
    sampleSize: z.number().int().nonnegative().optional(),
  })
  .superRefine((point, ctx) => {
    if (
      point.x < point.xRange.low ||
      point.x > point.xRange.high ||
      point.y < point.yRange.low ||
      point.y > point.yRange.high
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Ranges must contain the point' });
    }
    if (
      point.kind === 'institution' &&
      (!point.evidence.some((e) => e.axis === 'growth') ||
        !point.evidence.some((e) => e.axis === 'inflation'))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Institution points need evidence on both axes',
      });
    }
  });
export const IndicatorSchema = z.object({
  id: z.string(),
  name: z.string(),
  axis: z.enum(['growth', 'inflation']),
  provider: z.string(),
  sourceUrl: httpsUrl,
  period: z.string(),
  retrievedAt: z.string().datetime(),
  value: z.number(),
  unit: z.string(),
  currentMomentum: z.number(),
  priorMomentum: z.number(),
  acceleration: z.number(),
  score: z.number().min(-3).max(3),
  transform: z.string(),
  history: z.array(z.object({ date: z.string(), value: z.number() })),
  mode: z.enum(['momentum', 'level']).optional(),
  benchmark: z.number().optional(),
  referenceWindow: z.string().optional(),
});
export const DocumentSchema = z.object({
  id: z.string(),
  institution: z.string(),
  shortName: z.string(),
  color: z.string(),
  title: z.string(),
  url: httpsUrl,
  publishedAt: z.string().datetime().nullable(),
  datePrecision: z.enum(['month']).optional(),
  retrievedAt: z.string().datetime(),
  status: z.enum(['scored', 'unscored', 'stale', 'error', 'news']),
  reason: z.string(),
  type: z.enum(['commentary', 'news']),
  excerpt: z.string().max(1200),
});
export const SourceStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: httpsUrl,
  type: z.enum(['commentary', 'news', 'data']),
  status: z.enum(['ok', 'partial', 'error', 'not_configured']),
  checkedAt: z.string().datetime(),
  message: z.string(),
});
export const SnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  asOf: z.string().datetime(),
  generatedAt: z.string().datetime(),
  region: z.literal('US'),
  demo: z.boolean(),
  methodologyVersion: z.literal('1.0.0'),
  points: z.array(PointSchema),
  indicators: z.array(IndicatorSchema),
  documents: z.array(DocumentSchema),
  sources: z.array(SourceStatusSchema),
  warnings: z.array(z.string()),
  axisMode: z.enum(['momentum', 'levels']).optional(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;
export type Point = z.infer<typeof PointSchema>;
export type Indicator = z.infer<typeof IndicatorSchema>;
export type ResearchDocument = z.infer<typeof DocumentSchema>;
export type SourceStatus = z.infer<typeof SourceStatusSchema>;
export type Axis = 'growth' | 'inflation';
export type ReportedScenario = z.infer<typeof ReportedScenarioSchema>;
export type ForwardGuidance = z.infer<typeof ForwardGuidanceSchema>;

export function regime(x: number, y: number): string {
  if (Math.abs(x) < 0.08 || Math.abs(y) < 0.08) return 'At the boundary';
  return x > 0
    ? y > 0
      ? 'Overheating'
      : 'Goldilocks'
    : y > 0
      ? 'Stagflation'
      : 'Disinflationary slowdown';
}
export function isStale(date: string, asOf: string, days = 35): boolean {
  return Date.parse(asOf) - Date.parse(date) > days * 86_400_000;
}

export function axisSupport(view: Point, data: Point, axis: Axis): string {
  const direction = axis === 'growth' ? view.growthDirection : view.inflationDirection;
  if (direction === 'unclear') return 'View unresolved';
  const center = axis === 'growth' ? view.x : view.y;
  if (
    view.reportedScenarios?.some((s) => {
      const positive =
        axis === 'growth'
          ? ['Overheating', 'Goldilocks'].includes(s.quadrant)
          : ['Overheating', 'Stagflation'].includes(s.quadrant);
      return positive !== center > 0;
    })
  )
    return 'Report includes opposing scenario';
  const range = axis === 'growth' ? data.xRange : data.yRange;
  if (range.low <= 0 && range.high >= 0) return 'Data inconclusive';
  const a = axis === 'growth' ? view.x : view.y,
    b = axis === 'growth' ? data.x : data.y;
  if (Math.abs(a) < 0.08 || Math.abs(b) < 0.08) return 'Near boundary';
  return a * b > 0 ? 'Mapped center aligned' : 'Mapped center diverges';
}
