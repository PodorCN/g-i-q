import { regime, type Point, type ReportedScenario } from '../shared/schema';
import { verifiedSnippet } from './analysis';

const weakGrowth = /\brecession\b|\bcontract(?:ion|ing)?\b|(?:growth|GDP).{0,35}below[- ]trend/i;
const strongGrowth = /(?:growth|GDP).{0,35}above[- ]trend|above[- ]trend.{0,25}(?:growth|GDP)/i;
const highInflation =
  /(?:rising|higher|high|elevated|above[- ]target|persistent).{0,25}inflation|inflation.{0,35}(?:ris(?:e|ing)|above[- ]target|remain elevated)/i;
const lowInflation =
  /(?:inflation|core PCE).{0,35}below.{0,12}(?:target|2\s*%)|below[- ]target.{0,20}inflation/i;

/** Evidence gates, not a probability estimator. A one-axis risk cannot authorize a quadrant. */
export function verifiedScenarios(
  text: string,
  candidates: ReportedScenario[] | undefined,
  point: Pick<Point, 'x' | 'y'>,
): ReportedScenario[] {
  const result: ReportedScenario[] = [];
  for (const candidate of candidates || []) {
    if (
      candidate.quadrant === regime(point.x, point.y) ||
      result.some((s) => s.quadrant === candidate.quadrant)
    )
      continue;
    const growthQuote = verifiedSnippet(text, candidate.growthQuote, 'growth', true);
    const inflationQuote = verifiedSnippet(text, candidate.inflationQuote, 'inflation', true);
    if (!growthQuote || !inflationQuote || !candidate.horizonLabel.trim()) continue;
    const quotes = growthQuote + ' ' + inflationQuote;
    const positions = [text.indexOf(growthQuote), text.indexOf(inflationQuote)];
    if (Math.abs(positions[0] - positions[1]) > 1600) continue;
    const context = [growthQuote, inflationQuote]
      .map((quote, index) => {
        const at = positions[index];
        const prefix =
          text
            .slice(Math.max(0, at - 160), at)
            .split(/[.!?]\s/)
            .at(-1) || '';
        const suffix = text.slice(at + quote.length, at + quote.length + 160).split(/[.!?]\s/)[0];
        return prefix + quote + suffix;
      })
      .join(' ');
    const qualifiedContext = context.replace(
      /\b(?:cannot|can't|could not|couldn't|do not|don't|does not|doesn't)\s+rule out\b|\bnot ruling out\b/gi,
      'consider',
    );
    // Fail closed on denial/attribution; do not extract a keyword from a rejected scenario.
    if (
      /\b(?:no|not|never|unlikely|avoid\w*|reject\w*|rule[sd]? out|neither)\b|\b(?:Fed|Federal Reserve|ECB|other analysts|market consensus).{0,30}\b(?:expect|forecast|say|said|predict)/i.test(
        qualifiedContext,
      )
    )
      continue;
    const name =
      candidate.quadrant === 'Stagflation'
        ? /\bstagflation(?:ary)?\b/i
        : candidate.quadrant === 'Goldilocks'
          ? /\bgoldilocks\b/i
          : candidate.quadrant === 'Overheating'
            ? /\boverheating\b/i
            : /\bdisinflationary slowdown\b/i;
    const positiveGrowth = ['Overheating', 'Goldilocks'].includes(candidate.quadrant);
    const positiveInflation = ['Overheating', 'Stagflation'].includes(candidate.quadrant);
    const growthSupported = (positiveGrowth ? strongGrowth : weakGrowth).test(growthQuote);
    const inflationSupported = positiveInflation
      ? highInflation.test(inflationQuote) &&
        (point.y > 0 || /above[- ]target/i.test(inflationQuote))
      : lowInflation.test(inflationQuote);
    if (!name.test(quotes) && !(growthSupported && inflationSupported)) continue;
    result.push({ ...candidate, growthQuote, inflationQuote });
  }
  return result.slice(0, 3);
}

/** Retired mapper widths must not survive through retained/cached institution points. */
export function sourceOnlyRanges(point: Point): Point {
  return point.kind === 'data'
    ? point
    : {
        ...point,
        rangeKind: 'none',
        xRange: { low: point.x, high: point.x },
        yRange: { low: point.y, high: point.y },
        reportedScenarios: point.reportedScenarios || [],
      };
}
