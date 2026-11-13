import { SnapshotSchema, type Snapshot } from '../shared/schema';
import { buildSnapshot, ASSESSMENT_PROMPT, AssessmentSchema, type Assess } from './collect';
import { LEVELS_PROMPT } from './levels';

interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface Env {
  DB: { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<unknown> };
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  AI_ENABLED?: string;
  AI_MODEL?: string;
  ADMIN_TOKEN?: string;
  ALLOWED_ORIGIN?: string;
  BLS_API_KEY?: string;
}
interface Context {
  waitUntil(promise: Promise<unknown>): void;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}
async function authenticated(request: Request, token?: string): Promise<boolean> {
  if (!token || token.length < 24) return false;
  const actual = request.headers.get('Authorization') || '';
  const digest = async (text: string) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const [a, b] = await Promise.all([digest(actual), digest(`Bearer ${token}`)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
export function createAssessor(env: Env): Assess | undefined {
  if (env.AI_ENABLED !== 'true' || !env.AI) return undefined;
  return async (text, title) => {
    const properties = {
      growthRate: { type: 'number', minimum: -1, maximum: 5 },
      coreInflationRate: { type: 'number', minimum: 0, maximum: 5 },
      forwardGuidance: {
        type: 'array',
        maxItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            from: {
              type: 'object',
              additionalProperties: false,
              properties: {
                period: { type: 'string' },
                growthRate: { type: 'number' },
                coreInflationRate: { type: 'number' },
              },
              required: ['period', 'growthRate', 'coreInflationRate'],
            },
            to: {
              type: 'object',
              additionalProperties: false,
              properties: {
                period: { type: 'string' },
                growthRate: { type: 'number' },
                coreInflationRate: { type: 'number' },
              },
              required: ['period', 'growthRate', 'coreInflationRate'],
            },
            growthMeasure: {
              type: 'string',
              enum: ['real-gdp-q4q4', 'real-gdp-annual-average', 'real-gdp-qoq-annualized'],
            },
            inflationMeasure: { type: 'string', enum: ['core-pce-yoy'] },
            growthQuote: { type: 'string', maxLength: 240 },
            inflationQuote: { type: 'string', maxLength: 240 },
            periodQuote: { type: 'string', maxLength: 240 },
          },
          required: [
            'from',
            'to',
            'growthMeasure',
            'inflationMeasure',
            'growthQuote',
            'inflationQuote',
            'periodQuote',
          ],
        },
      },
      reportedScenarios: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            quadrant: {
              type: 'string',
              enum: ['Overheating', 'Stagflation', 'Goldilocks', 'Disinflationary slowdown'],
            },
            growthQuote: { type: 'string', maxLength: 240 },
            inflationQuote: { type: 'string', maxLength: 240 },
            horizonLabel: { type: 'string', maxLength: 160 },
          },
          required: ['quadrant', 'growthQuote', 'inflationQuote', 'horizonLabel'],
        },
      },
      growthBasis: { type: 'string', enum: ['direct', 'inferred'] },
      inflationBasis: { type: 'string', enum: ['direct', 'inferred'] },
      horizon: { type: 'string', enum: ['current', 'outlook'] },
      horizonLabel: { type: 'string' },
      growthQuote: { type: 'string' },
      inflationQuote: { type: 'string' },
      rationale: { type: 'string' },
      confidence: { type: 'string', enum: ['low', 'medium'] },
      growthOutlook: { type: 'string', enum: ['rising', 'falling', 'steady', 'unspecified'] },
      inflationOutlook: { type: 'string', enum: ['rising', 'falling', 'steady', 'unspecified'] },
      growthOutlookQuote: { type: 'string' },
      inflationOutlookQuote: { type: 'string' },
      outlookHorizon: { type: 'string' },
    };
    const output = await env.AI!.run(env.AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: LEVELS_PROMPT },
        { role: 'user', content: JSON.stringify({ title, article: text.slice(0, 24000) }) },
      ],
      max_tokens: 2600,
      response_format: {
        type: 'json_schema',
        json_schema: {
          type: 'object',
          additionalProperties: false,
          properties,
          required: Object.keys(properties),
        },
      },
    });
    const response = (output as { response?: unknown }).response ?? output;
    return AssessmentSchema.parse(
      typeof response === 'string'
        ? JSON.parse(response.replace(/^```(?:json)?\s*|\s*```$/g, ''))
        : response,
    );
  };
}

async function latest(env: Env): Promise<Snapshot | null> {
  const row = await env.DB.prepare(
    'SELECT payload FROM snapshots ORDER BY as_of DESC LIMIT 1',
  ).first<{ payload: string }>();
  return row ? SnapshotSchema.parse(JSON.parse(row.payload)) : null;
}
async function persist(env: Env, snapshot: Snapshot): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO snapshots (id, as_of, generated_at, payload) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
  )
    .bind(snapshot.id, snapshot.asOf, snapshot.generatedAt, JSON.stringify(snapshot))
    .run();
}
export async function acquireRefresh(env: Env, id: string): Promise<boolean> {
  // The partial unique index is the atomic cross-isolate refresh lock.
  await env.DB.prepare(
    "UPDATE refresh_runs SET status = 'failed', finished_at = ?, message = 'Refresh exceeded 30 minutes' WHERE status = 'running' AND started_at < ?",
  )
    .bind(new Date().toISOString(), new Date(Date.now() - 30 * 60_000).toISOString())
    .run();
  try {
    await env.DB.prepare(
      "INSERT INTO refresh_runs (id, started_at, status) VALUES (?, ?, 'running')",
    )
      .bind(id, new Date().toISOString())
      .run();
    return true;
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(String(error))) return false;
    throw error;
  }
}
export async function refresh(env: Env, id: string): Promise<void> {
  try {
    const snapshot = await buildSnapshot({
      previous: await latest(env),
      assess: createAssessor(env),
      blsApiKey: env.BLS_API_KEY,
      axisMode: 'levels',
    });
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO snapshots (id, as_of, generated_at, payload) VALUES (?, ?, ?, ?)',
      ).bind(snapshot.id, snapshot.asOf, snapshot.generatedAt, JSON.stringify(snapshot)),
      env.DB.prepare(
        "UPDATE refresh_runs SET status = 'success', finished_at = ?, snapshot_id = ?, message = ? WHERE id = ?",
      ).bind(
        new Date().toISOString(),
        snapshot.id,
        `${snapshot.points.length} points; ${snapshot.indicators.length} indicators`,
        id,
      ),
    ]);
  } catch (error) {
    console.error(
      'Research refresh failed',
      error instanceof Error ? error.message : 'Unknown error',
    );
    await env.DB.prepare(
      "UPDATE refresh_runs SET status = 'failed', finished_at = ?, message = 'Research refresh failed; previous snapshot retained' WHERE id = ?",
    )
      .bind(new Date().toISOString(), id)
      .run();
  }
}
export function isResearchHour(date: Date): boolean {
  return (
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(date) === '07'
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const cors: Record<string, string> =
      origin && origin === env.ALLOWED_ORIGIN
        ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
        : {};
    if (request.method === 'OPTIONS')
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        },
      });
    try {
      let response: Response;
      if (request.method === 'GET' && url.pathname === '/api/health') {
        const run = await env.DB.prepare(
          'SELECT id, started_at, finished_at, status, message FROM refresh_runs ORDER BY started_at DESC LIMIT 1',
        ).first();
        const snapshot = await env.DB.prepare(
          'SELECT id, as_of FROM snapshots ORDER BY as_of DESC LIMIT 1',
        ).first();
        response = json(
          {
            ready: !!snapshot,
            aiEnabled: env.AI_ENABLED === 'true' && !!env.AI,
            snapshot,
            lastRun: run,
          },
          snapshot ? 200 : 503,
        );
      } else if (request.method === 'GET' && url.pathname === '/api/history') {
        const rows = await env.DB.prepare(
          "SELECT id, as_of AS asOf, json_extract(payload, '$.axisMode') AS axisMode FROM snapshots ORDER BY as_of DESC LIMIT 90",
        ).all();
        response = json({ snapshots: rows.results }, 200, {
          'Cache-Control': 'public, max-age=60',
        });
      } else if (request.method === 'GET' && url.pathname === '/api/snapshot') {
        const id = url.searchParams.get('id');
        if (id && !/^[a-zA-Z0-9:_-]{1,100}$/.test(id))
          return json({ error: 'Invalid snapshot ID' }, 400);
        const row = id
          ? await env.DB.prepare('SELECT id, payload FROM snapshots WHERE id = ?')
              .bind(id)
              .first<{ id: string; payload: string }>()
          : await env.DB.prepare(
              'SELECT id, payload FROM snapshots ORDER BY as_of DESC LIMIT 1',
            ).first<{ id: string; payload: string }>();
        if (!row)
          return json(
            {
              error: id
                ? 'Snapshot not found'
                : 'No snapshot yet. Trigger the first backend refresh.',
            },
            id ? 404 : 503,
          );
        const headers = {
          'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
          ETag: `"${row.id}"`,
          ...cors,
        };
        response =
          request.headers.get('If-None-Match') === headers.ETag
            ? new Response(null, { status: 304, headers })
            : new Response(row.payload, {
                headers: {
                  ...headers,
                  'Content-Type': 'application/json',
                  'X-Content-Type-Options': 'nosniff',
                },
              });
      } else if (
        request.method === 'POST' &&
        (url.pathname === '/api/refresh' || url.pathname === '/api/import')
      ) {
        if (!(await authenticated(request, env.ADMIN_TOKEN)))
          return json({ error: 'Unauthorized; configure a 24+ character ADMIN_TOKEN' }, 401);
        if (url.pathname === '/api/import') {
          const text = await request.text();
          if (text.length > 2_000_000)
            return json({ error: 'Snapshot exceeds the import limit' }, 413);
          const snapshot = SnapshotSchema.parse(JSON.parse(text));
          if (snapshot.demo || Date.parse(snapshot.asOf) > Date.now() + 300_000)
            return json({ error: 'Only real, non-future snapshots can be imported' }, 400);
          const existing = await env.DB.prepare('SELECT payload FROM snapshots WHERE id = ?')
            .bind(snapshot.id)
            .first<{ payload: string }>();
          if (existing && JSON.stringify(JSON.parse(existing.payload)) !== JSON.stringify(snapshot))
            return json(
              { error: 'Snapshot IDs are immutable. Import a new snapshot ID instead.' },
              409,
            );
          await persist(env, snapshot);
          response = json({ imported: snapshot.id });
        } else {
          const id = crypto.randomUUID();
          if (!(await acquireRefresh(env, id)))
            return json({ error: 'A refresh is already running' }, 409);
          // Keep manual requests alive: HTTP waitUntil has a 30-second post-response limit.
          // Cron events have a longer execution window and use waitUntil below.
          await refresh(env, id);
          const run = await env.DB.prepare(
            'SELECT status, message, snapshot_id FROM refresh_runs WHERE id = ?',
          )
            .bind(id)
            .first();
          response = json({ runId: id, ...run });
        }
      } else response = json({ error: 'Not found' }, 404);
      for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
      return response;
    } catch (error) {
      if (error instanceof SyntaxError || (error instanceof Error && error.name === 'ZodError'))
        return json({ error: 'Invalid snapshot payload' }, 400);
      console.error('API failure', error instanceof Error ? error.message : 'Unknown error');
      return json(
        { error: 'Research storage is unavailable. Check D1 migrations and backend logs.' },
        503,
      );
    }
  },
  async scheduled(controller: { scheduledTime: number }, env: Env, ctx: Context) {
    const date = new Date(controller.scheduledTime);
    if (!isResearchHour(date)) return;
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
    const id = `daily-${day}`;
    if (await acquireRefresh(env, id)) ctx.waitUntil(refresh(env, id));
  },
};
