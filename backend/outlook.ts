import { verifiedSnippet } from './analysis';
import { OutlookDirectionSchema, type Point } from '../shared/schema';

export type OutlookAssessment = {
  growthOutlook?: 'rising' | 'falling' | 'steady' | 'unspecified';
  inflationOutlook?: 'rising' | 'falling' | 'steady' | 'unspecified';
  growthOutlookQuote?: string;
  inflationOutlookQuote?: string;
  outlookHorizon?: string;
};

export function verifiedOutlook(
  text: string,
  assessment: OutlookAssessment,
): Point['outlookDirection'] {
  if (!assessment.outlookHorizon?.trim()) return undefined;
  const result: NonNullable<Point['outlookDirection']> = {
    growth: 'unspecified',
    inflation: 'unspecified',
    horizonLabel: assessment.outlookHorizon,
    evidence: [],
  };
  for (const axis of ['growth', 'inflation'] as const) {
    const direction = assessment[`${axis}Outlook`];
    const passage = assessment[`${axis}OutlookQuote`] || '';
    if (!direction || direction === 'unspecified') continue;
    const quote = verifiedSnippet(text, passage, axis, true);
    if (!quote) continue;
    result[axis] = direction;
    result.evidence.push({
      axis,
      quote,
      interpretation: `${axis === 'growth' ? 'Growth' : 'Inflation'}: ${direction}. Qualitative direction only; arrow length is not a forecast magnitude.`,
    });
  }
  const parsed = OutlookDirectionSchema.safeParse(result);
  return parsed.success ? parsed.data : undefined;
}
