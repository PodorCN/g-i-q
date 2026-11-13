import { ForwardGuidanceSchema, type ForwardGuidance } from '../shared/schema';
import { verifiedSnippet } from './analysis';

function pairedPassage(text: string, quote: string, axis: 'growth' | 'inflation', rates: number[]) {
  const verified = verifiedSnippet(text, quote, axis, true);
  if (!verified) return '';
  const numbers = [...verified.matchAll(/(?<![\w.])(-?\d+(?:\.\d+)?)\s*%/g)].map((m) =>
    Number(m[1]),
  );
  if (rates.every((n) => numbers.includes(n))) return verified;
  // A model sometimes stops mid-sentence after the first rate. Complete only that
  // same source sentence, within the quotation limit; never search for a different claim.
  const start = text.indexOf(verified),
    tail = text.slice(start, start + 240);
  const end = tail.match(/[.!?](?=\s+[A-Z]|$)/);
  if (!end) return verified;
  return verifiedSnippet(text, tail.slice(0, end.index! + 1), axis, true) || verified;
}

export function verifiedForwardGuidance(
  text: string,
  candidate?: ForwardGuidance,
  publishedAt?: string,
): ForwardGuidance | undefined {
  const parsed = ForwardGuidanceSchema.safeParse(candidate);
  if (!parsed.success) return undefined;
  const g = parsed.data;
  if (publishedAt) {
    const [year, quarter] = g.to.period.split('-Q').map(Number);
    const endOfPeriod = Date.UTC(year, (quarter || 4) * 3, 0, 23, 59, 59);
    if (endOfPeriod < Date.parse(publishedAt)) return undefined;
  }
  const growthQuote = pairedPassage(text, g.growthQuote, 'growth', [
    g.from.growthRate,
    g.to.growthRate,
  ]);
  const inflationQuote = pairedPassage(text, g.inflationQuote, 'inflation', [
    g.from.coreInflationRate,
    g.to.coreInflationRate,
  ]);
  const periodQuote = verifiedSnippet(text, g.periodQuote, 'growth', true);
  if (!growthQuote || !inflationQuote || !periodQuote) return undefined;
  const quotes = [growthQuote, inflationQuote, periodQuote].join(' ');
  const context = [growthQuote, inflationQuote]
    .map((quote) => {
      const at = text.indexOf(quote);
      return (
        (text
          .slice(Math.max(0, at - 160), at)
          .split(/[.!?]\s/)
          .at(-1) || '') + quote
      );
    })
    .join(' ');
  if (
    /\b(?:if|risk scenario|downside scenario|upside scenario|do not expect|not our forecast)\b|\b(?:Fed|Federal Reserve|ECB|market consensus|other analysts).{0,35}\b(?:expect\w*|forecast\w*|project\w*|predict\w*)/i.test(
      context,
    )
  )
    return undefined;
  if (
    !/\breal\b.{0,20}\bGDP\b|real gross domestic product/i.test(growthQuote) ||
    !/\bcore\b.{0,55}(?:\bPCE\b|personal consumption expenditures)/i.test(inflationQuote) ||
    /\b(?:if|could|risk|scenario|global|world|eurozone|China)\b/i.test(quotes)
  )
    return undefined;
  if (g.growthMeasure === 'real-gdp-q4q4' && !/Q4(?:[ -]over[ -]|\s*\/\s*)Q4/i.test(quotes))
    return undefined;
  if (g.growthMeasure === 'real-gdp-annual-average' && !/annual average/i.test(growthQuote))
    return undefined;
  if (
    g.growthMeasure === 'real-gdp-qoq-annualized' &&
    !/quarter.{0,20}annualized|q\/q.{0,20}annualized/i.test(growthQuote)
  )
    return undefined;
  if (!/year.over.year|y\/y|Q4(?:[ -]over[ -]|\s*\/\s*)Q4/i.test(inflationQuote)) return undefined;
  const rates = (quote: string) =>
    [...quote.matchAll(/(?<![\w.])(-?\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1]));
  const growth = rates(growthQuote),
    inflation = rates(inflationQuote);
  for (const endpoint of [g.from, g.to]) {
    if (!growth.includes(endpoint.growthRate) || !inflation.includes(endpoint.coreInflationRate))
      return undefined;
    if (
      ![growthQuote, inflationQuote].every((quote) =>
        (quote + ' ' + periodQuote).includes(endpoint.period.slice(0, 4)),
      )
    )
      return undefined;
    const quarter = endpoint.period.split('-')[1];
    if (quarter && !quotes.includes(quarter)) return undefined;
  }
  // For compact forecast tables, validate the year-to-column correspondence as well as numbers.
  const years = [...periodQuote.matchAll(/20\d{2}f?\b/g)].map((m) => m[0].slice(0, 4));
  if (
    !periodQuote.includes('%') &&
    years.length === growth.length &&
    years.length === inflation.length
  ) {
    for (const endpoint of [g.from, g.to]) {
      const index = years.indexOf(endpoint.period.slice(0, 4));
      if (
        index < 0 ||
        growth[index] !== endpoint.growthRate ||
        inflation[index] !== endpoint.coreInflationRate
      )
        return undefined;
    }
  }
  return { ...g, growthQuote, inflationQuote, periodQuote };
}
