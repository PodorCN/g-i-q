import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildSnapshot,
  ASSESSMENT_PROMPT,
  AssessmentSchema,
  type Assess,
} from '../backend/collect';
import { LEVELS_PROMPT } from '../backend/levels';
import { SnapshotSchema, type Snapshot } from '../shared/schema';

let previous: Snapshot | null = null;
try {
  previous = SnapshotSchema.parse(JSON.parse(await fs.readFile('data/latest.json', 'utf8')));
} catch {
  /* first run */
}
let assess: Assess | undefined;
if (process.env.OPENAI_API_KEY) {
  assess = async (text, title) => {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: LEVELS_PROMPT },
          { role: 'user', content: JSON.stringify({ title, article: text.slice(0, 24_000) }) },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Model API returned HTTP ${response.status}`);
    const result = (await response.json()) as { choices: { message: { content: string } }[] };
    return AssessmentSchema.parse(JSON.parse(result.choices[0].message.content));
  };
}
const snapshot = await buildSnapshot({
  previous,
  assess,
  blsApiKey: process.env.BLS_API_KEY,
  axisMode: 'levels',
});
await fs.mkdir('data', { recursive: true });
const serialized = JSON.stringify(snapshot, null, 2) + '\n';
await fs.writeFile('data/latest.json.tmp', serialized);
await fs.rename('data/latest.json.tmp', 'data/latest.json');
if (process.argv.includes('--bootstrap')) {
  await fs.mkdir('public/data', { recursive: true });
  await fs.writeFile('public/data/bootstrap.json', serialized);
}
console.log(
  `Collected ${snapshot.id}: ${snapshot.points.length} points, ${snapshot.indicators.length} indicators, ${snapshot.documents.length} documents.`,
);
for (const source of snapshot.sources)
  console.log(`${source.status.padEnd(8)} ${source.name}: ${source.message}`);
if (process.env.GIQ_API_URL && process.env.GIQ_ADMIN_TOKEN) {
  const response = await fetch(new URL('/api/import', process.env.GIQ_API_URL), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GIQ_ADMIN_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: serialized,
  });
  if (!response.ok) throw new Error(`Backend import failed: HTTP ${response.status}`);
  console.log('Published to the backend. The frontend has not changed.');
} else console.log(`Saved ${path.resolve('data/latest.json')}. No remote backend was modified.`);
