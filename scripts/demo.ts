import fs from 'node:fs/promises';
import { calculateIndicator, dataPoint } from '../backend/analysis';
import { SERIES } from '../backend/sources';
import { SnapshotSchema, type Point, type Snapshot } from '../shared/schema';

const now = new Date().toISOString();
const rows = Array.from({ length: 36 }, (_, index) => ({
  date: new Date(Date.UTC(2023, index, 1)).toISOString().slice(0, 10),
  value: 100 + index * 0.16 + Math.sin(index * 0.61) * 0.24,
}));
const indicators = SERIES.map((series, index) =>
  calculateIndicator(
    { ...series, provider: 'Illustrative data', sourceUrl: 'https://example.com/giq-demo' },
    rows.map((row) => ({ ...row, value: row.value * (index + 1) })),
    series.transform,
    now,
  ),
);
const composite = dataPoint(
  indicators.map((item) => ({ ...item, period: now.slice(0, 7) })),
  now,
)!;
composite.x = 0.32;
composite.y = 0.63;
composite.xRange = { low: -0.18, high: 0.71 };
composite.yRange = { low: 0.3, high: 0.91 };
composite.title = 'Illustrative data composite';
composite.sourceUrl = 'https://example.com/giq-demo';
composite.summary =
  'Fictional numbers for demonstrating the interface. Not a current market assessment.';
const definitions = [
  ['northstar', 'Northstar Macro', '#287b78', 0.62, 0.62, 'current'],
  ['meridian', 'Meridian Research', '#4268ca', 0.62, -0.62, 'current'],
  ['harbor', 'Harbor Strategy', '#b77a44', -0.62, 0.62, 'current'],
  ['atlas', 'Atlas Economics', '#8870af', -0.62, -0.62, 'current'],
  ['cedar', 'Cedar Research', '#8d6d7f', 0.62, 0.62, 'current'],
  ['outlook', 'Northstar Macro', '#287b78', 0.62, -0.62, 'outlook'],
] as const;
const points: Point[] = definitions.map(([id, name, color, x, y, horizon]) => ({
  id,
  institution: `${name} (fictional demo)`,
  shortName: name,
  color,
  kind: 'institution',
  x,
  y,
  xRange: { low: x - 0.44, high: x + 0.44 },
  yRange: { low: y - 0.44, high: y + 0.44 },
  rangeKind: 'model_range',
  confidence: 'medium',
  horizon,
  publishedAt: now,
  retrievedAt: now,
  sourceUrl: `https://example.com/giq-demo#${id}`,
  title: 'Illustrative macro commentary',
  summary:
    'Fictional research for testing attribution, overlapping points, filters and uncertainty displays.',
  method: 'reviewed',
  evidence: [
    {
      axis: 'growth',
      quote:
        x > 0
          ? 'Our illustrative base case has growth accelerating.'
          : 'Our illustrative base case has growth slowing.',
      interpretation: 'Demo text only; not a real institution’s view.',
    },
    {
      axis: 'inflation',
      quote:
        y > 0
          ? 'Our illustrative base case has inflation rising.'
          : 'Our illustrative base case has inflation cooling.',
      interpretation: 'Demo text only; not a real institution’s view.',
    },
  ],
}));
const snapshot: Snapshot = SnapshotSchema.parse({
  schemaVersion: 1,
  id: 'demo-illustrative',
  asOf: now,
  generatedAt: now,
  region: 'US',
  demo: true,
  methodologyVersion: '1.0.0',
  points: [composite, ...points],
  indicators,
  documents: points.map((point) => ({
    id: point.id,
    institution: point.institution,
    shortName: point.shortName,
    color: point.color,
    title: point.title,
    url: point.sourceUrl,
    publishedAt: now,
    retrievedAt: now,
    status: 'scored',
    reason: 'Illustrative demo: both axes are fictional.',
    type: 'commentary',
    excerpt: '',
  })),
  sources: definitions
    .slice(0, 5)
    .map(([id, name]) => ({
      id,
      name: `${name} (demo)`,
      url: 'https://example.com/giq-demo',
      type: 'commentary',
      status: 'ok',
      checkedAt: now,
      message: 'Fictional demonstration source.',
    })),
  warnings: [
    'Every institution and number in this mode is illustrative.',
    'Use the main research view for actually collected evidence.',
  ],
});
await fs.mkdir('public/data', { recursive: true });
await fs.writeFile('public/data/demo.json', JSON.stringify(snapshot, null, 2) + '\n');
console.log('Created explicitly labeled demo at /?demo=1');
