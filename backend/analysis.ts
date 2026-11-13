import type { Indicator, Point } from '../shared/schema';

export const clamp = (value: number, min = -1.25, max = 1.25) =>
  Math.max(min, Math.min(max, value));
export const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - average) ** 2, 0) / (values.length - 1));
}
export function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}
export function random(seed = 1701): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
}
export function bootstrap(values: number[], iterations = 2000) {
  if (values.length < 2) throw new Error('At least two indicators per axis are required');
  const rng = random();
  const estimates = Array.from({ length: iterations }, () =>
    mean(values.map(() => values[Math.floor(rng() * values.length)])),
  );
  const center = mean(values);
  return {
    low: Math.min(center, quantile(estimates, 0.1)),
    high: Math.max(center, quantile(estimates, 0.9)),
  };
}

export type Observation = { date: string; value: number };
export type Transform = 'payroll' | 'annualized' | 'unemployment';
export function momentum(rows: Observation[], index: number, transform: Transform): number {
  if (index < 3) throw new Error('Three months of prior observations are required');
  if (transform === 'payroll') return (rows[index].value - rows[index - 3].value) / 3;
  if (transform === 'unemployment') return -(rows[index].value - rows[index - 3].value);
  return ((rows[index].value / rows[index - 3].value) ** 4 - 1) * 100;
}

export function calculateIndicator(
  meta: Pick<Indicator, 'id' | 'name' | 'axis' | 'provider' | 'sourceUrl' | 'unit'>,
  observations: Observation[],
  transform: Transform,
  retrievedAt: string,
): Indicator {
  const rows = observations
    .filter((o) => o.date <= retrievedAt.slice(0, 10) && Number.isFinite(o.value))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 18)
    throw new Error(`${meta.name}: need 18 monthly observations, got ${rows.length}`);
  const month = (date: string) => {
    const parsed = new Date(date);
    return parsed.getUTCFullYear() * 12 + parsed.getUTCMonth();
  };
  for (let i = 1; i < rows.length; i++)
    if (month(rows[i].date) === month(rows[i - 1].date))
      throw new Error(`${meta.name}: duplicate month`);
  const contiguous = (index: number) =>
    index >= 6 && month(rows[index].date) - month(rows[index - 6].date) === 6;
  const end = rows.length - 1;
  if (!contiguous(end))
    throw new Error(`${meta.name}: missing months in the current six-month comparison window`);
  const currentMomentum = momentum(rows, end, transform);
  const priorMomentum = momentum(rows, end - 3, transform);
  const acceleration = currentMomentum - priorMomentum;
  // Scale the sign-preserving acceleration by past volatility; never subtract a mean.
  const past = rows
    .slice(0, end)
    .map((_, i) =>
      contiguous(i) ? momentum(rows, i, transform) - momentum(rows, i - 3, transform) : null,
    )
    .filter((v): v is number => v !== null)
    .slice(-60);
  if (past.length < 6)
    throw new Error(`${meta.name}: fewer than six usable historical acceleration windows`);
  const scale = stdev(past);
  if (!Number.isFinite(scale) || scale < 1e-9)
    throw new Error(`${meta.name}: insufficient historical variation to normalize`);
  return {
    ...meta,
    period: rows[end].date.slice(0, 7),
    retrievedAt,
    value: rows[end].value,
    currentMomentum,
    priorMomentum,
    acceleration,
    score: Math.tanh(acceleration / scale),
    transform:
      transform === 'payroll'
        ? 'Average monthly payroll additions over 3 months, minus the previous 3-month average.'
        : transform === 'unemployment'
          ? 'Inverted 3-month change in unemployment, minus the previous 3-month change.'
          : '3-month annualized rate, minus the previous non-overlapping 3-month annualized rate.',
    history: rows.slice(-18),
  };
}

export function dataPoint(indicators: Indicator[], now: string): Point | null {
  // Do not use releases more than 90 days behind their reference month.
  const current = indicators.filter(
    (i) => Date.parse(now) - Date.parse(i.period + '-01') <= 90 * 86_400_000,
  );
  const growth = current.filter((i) => i.axis === 'growth'),
    inflation = current.filter((i) => i.axis === 'inflation');
  if (growth.length < 2 || inflation.length < 2) return null;
  const x = mean(growth.map((i) => i.score)),
    y = mean(inflation.map((i) => i.score));
  const latestRetrieval = current
    .map((indicator) => indicator.retrievedAt)
    .sort()
    .at(-1)!;
  return {
    id: 'hard-data',
    institution: 'Hard data composite',
    shortName: 'Hard data',
    color: '#16314b',
    kind: 'data',
    x,
    y,
    xRange: bootstrap(growth.map((i) => i.score)),
    yRange: bootstrap(inflation.map((i) => i.score)),
    rangeKind: 'bootstrap_80',
    confidence: 'medium',
    horizon: 'current',
    publishedAt: latestRetrieval,
    retrievedAt: latestRetrieval,
    sourceUrl: 'https://www.bls.gov/data/',
    title: 'The latest available U.S. labor and consumer-price data',
    summary: `Equal-weight direction signals from ${growth.length} labor/activity indicators and ${inflation.length} consumer-price indicators. This is a narrow U.S. proxy, not a complete economic nowcast.`,
    evidence: [
      {
        axis: 'growth',
        quote: '',
        interpretation: growth
          .map((i) => `${i.name}: ${i.score >= 0 ? '+' : ''}${i.score.toFixed(2)} (${i.period})`)
          .join('; '),
      },
      {
        axis: 'inflation',
        quote: '',
        interpretation: inflation
          .map((i) => `${i.name}: ${i.score >= 0 ? '+' : ''}${i.score.toFixed(2)} (${i.period})`)
          .join('; '),
      },
    ],
    method: 'data',
    sampleSize: growth.length + inflation.length,
  };
}

export type Direction = 'accelerating' | 'decelerating' | 'stable' | 'unclear';
export type Assessment = {
  growth: Direction;
  inflation: Direction;
  horizon: 'current' | 'outlook';
  growthQuote: string;
  inflationQuote: string;
  rationale: string;
  confidence: 'low' | 'medium';
};
const SENTENCES = /[^.!?\n]+(?:[.!?]|$)/g;
// Connect only a subject and its own predicate. A loose wildcard would read
// "solid growth, cooling inflation" as slowing growth, which is incorrect.
const connector =
  '(?:\\s+(?:is|has|have|been|was|are|will|to|expected|forecast|projected|likely|now|still|further|continued|continues|continuing|be|set|seen|appears|seems|remains|being|steadily|gradually|again|recently|significantly|materially)){0,8}\\s+';
const growthSubject =
  '\\b(?:economic growth|growth(?: momentum)?|economy|economic activity|hiring|job growth|employment|demand|spending)\\b';
const inflationSubject = '\\b(?:inflation(?: momentum)?|price pressures|consumer prices)\\b';
const growthUp = new RegExp(
  growthSubject +
    connector +
    '(?:accelerat\\w*|pick(?:ing|ed)? up|strengthen\\w*|rebound\\w*)\\b|\\b(?:accelerating|strengthening|rebounding)\\s+(?:US\\s+)?(?:growth|economy|hiring|demand)\\b|\\boverheating economy\\b',
  'i',
);
const growthDown = new RegExp(
  growthSubject +
    connector +
    '(?:slow(?:ing|ed|er|down)?|decelerat\\w*|weaken\\w*|cool(?:ing|ed)?)\\b|\\b(?:slowing|weaker|weakening|decelerating)\\s+(?:US\\s+)?(?:growth|economy|hiring|demand)\\b',
  'i',
);
const inflationUp = new RegExp(
  inflationSubject +
    connector +
    '(?:accelerat\\w*|ris(?:ing|e|en)|pick(?:ing|ed)? up|intensif\\w*|reaccelerat\\w*)\\b|\\b(?:rising|accelerating)\\s+(?:US\\s+)?(?:inflation|price pressures)\\b',
  'i',
);
const inflationDown = new RegExp(
  inflationSubject +
    connector +
    '(?:decelerat\\w*|fall(?:ing)?|slow(?:ing|ed|er)?|cool(?:ing|ed)?|eas(?:ing|ed)|fad(?:ing|e)|dissipat\\w*)\\b|\\b(?:falling|cooling|easing)\\s+(?:US\\s+)?(?:inflation|price pressures)\\b|\\bdisinflation\\b',
  'i',
);

export function assessRules(text: string): Assessment {
  const sentences = (text.match(SENTENCES) || [])
    .map((s) => s.trim())
    .filter((s) => s.length < 650);
  // Conditional scenarios and foreign-economy paragraphs cannot become current U.S. points.
  const relevant = sentences.filter(
    (s) =>
      !/\b(if|could|might|risk|risks|scenario|would|unless|not|isn't|no longer|china|chinese|euro|europe|japan|australia|uk|united kingdom)\b/i.test(
        s,
      ),
  );
  const find = (up: RegExp, down: RegExp): [Direction, string] => {
    const positive = relevant.find((s) => up.test(s));
    const negative = relevant.find((s) => down.test(s));
    if ((positive && negative) || (!positive && !negative)) return ['unclear', ''];
    return positive ? ['accelerating', positive] : ['decelerating', negative!];
  };
  let [growth, growthQuote] = find(growthUp, growthDown);
  let [inflation, inflationQuote] = find(inflationUp, inflationDown);
  const isOutlook = (sentence: string) =>
    /\b(expect|forecast|outlook|will|next year|next quarter|base case)\b/i.test(sentence);
  const outlook = isOutlook(growthQuote);
  if (growthQuote && inflationQuote && isOutlook(growthQuote) !== isOutlook(inflationQuote)) {
    growth = 'unclear';
    inflation = 'unclear';
    growthQuote = '';
    inflationQuote = '';
  }
  return {
    growth,
    inflation,
    growthQuote,
    inflationQuote,
    horizon: outlook ? 'outlook' : 'current',
    confidence: 'low',
    rationale:
      'Conservative phrase extraction. Coordinates summarize direction; they are not the institution’s own numerical forecast.',
  };
}

export function quoteWindow(text: string, evidence: string, axis: 'growth' | 'inflation'): string {
  const words = evidence.trim().split(/\s+/);
  const anchor = words.findIndex((w) =>
    axis === 'growth'
      ? /growth|econom|hiring|demand|overheat/i.test(w)
      : /inflation|prices|disinflation/i.test(w),
  );
  const start = Math.max(0, anchor - 2);
  const result = words.slice(start, start + 11).join(' ');
  return text.includes(result) ? result : '';
}

export function directionalCoordinate(direction: Direction): number {
  return direction === 'accelerating' ? 0.62 : direction === 'decelerating' ? -0.62 : 0;
}

export function verifiedSnippet(
  text: string,
  quote: string,
  axis: 'growth' | 'inflation',
  preservePassage = false,
): string {
  // Preserve decimal numbers when selecting the short excerpt (2.5% must not become 5%).
  const tokens = [...text.matchAll(/\p{N}+(?:[.,]\p{N}+)*|[\p{L}\p{N}]+/gu)];
  const query = [...quote.matchAll(/\p{N}+(?:[.,]\p{N}+)*|[\p{L}\p{N}]+/gu)].map((match) =>
    match[0].toLocaleLowerCase('en-US'),
  );
  if (query.length < 3) return '';
  const corpus = ' ' + tokens.map((match) => match[0].toLocaleLowerCase('en-US')).join(' ') + ' ';
  const position = corpus.indexOf(' ' + query.join(' ') + ' ');
  if (position < 0) return '';
  const tokenStart = corpus.slice(0, position).trim().split(/\s+/).filter(Boolean).length;
  if (preservePassage) {
    const end = tokens[tokenStart + query.length - 1];
    let endIndex = end.index! + end[0].length;
    // Preserve a quoted terminal unit/qualification (notably 5% vs 5), and punctuation.
    const suffix = quote.match(/[^\p{L}\p{N}]*$/u)?.[0] || '';
    if (suffix && text.slice(endIndex, endIndex + suffix.length) === suffix)
      endIndex += suffix.length;
    const passage = text.slice(tokens[tokenStart].index!, endIndex);
    // Direction evidence must retain its verb and qualifications, not just an axis keyword.
    return passage.length <= 240 ? passage : '';
  }
  const anchor = query.findIndex((word) =>
    axis === 'growth'
      ? /growth|econom|demand|hiring|employment|activity|spending/.test(word)
      : /inflation|price|cost|disinflation/.test(word),
  );
  const first = tokenStart + Math.max(0, anchor - 2);
  const last = Math.min(tokens.length - 1, first + 10, tokenStart + query.length - 1);
  return text.slice(tokens[first].index!, tokens[last].index! + tokens[last][0].length);
}
export function modelRange(center: number, confidence: 'low' | 'medium') {
  const width = confidence === 'medium' ? 0.44 : 0.78;
  return { low: clamp(center - width), high: clamp(center + width) };
}
