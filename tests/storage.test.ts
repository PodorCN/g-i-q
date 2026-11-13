import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { acquireRefresh, refresh, type Env } from '../backend/index';
import { SnapshotSchema } from '../shared/schema';

const databases: DatabaseSync[] = [];
function storage(): Env {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec(fs.readFileSync('backend/migrations/0001_snapshots.sql', 'utf8'));
  type Value = string | number | null | Uint8Array;
  const prepare = (sql: string) => {
    let values: Value[] = [];
    const statement = {
      bind(...params: unknown[]) {
        values = params as Value[];
        return statement;
      },
      async first<T>() {
        return (database.prepare(sql).get(...values) as T | undefined) || null;
      },
      async all<T>() {
        return { results: database.prepare(sql).all(...values) as T[] };
      },
      async run() {
        return database.prepare(sql).run(...values);
      },
    };
    return statement;
  };
  return {
    DB: {
      prepare,
      async batch(statements) {
        database.exec('BEGIN');
        try {
          const result = [];
          for (const statement of statements) result.push(await statement.run());
          database.exec('COMMIT');
          return result;
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      },
    },
    ADMIN_TOKEN: 'test-admin-secret-longer-than-24-characters',
  };
}
afterEach(() => {
  databases.splice(0).forEach((database) => database.close());
  vi.restoreAllMocks();
});
const context = { waitUntil: vi.fn() };
const base = SnapshotSchema.parse(
  JSON.parse(fs.readFileSync('public/data/bootstrap.json', 'utf8')),
);
const post = (env: Env, snapshot: unknown) =>
  worker.fetch(
    new Request('https://api.example/api/import', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    }),
    env,
    context,
  );

describe('Real SQLite storage and research run behavior', () => {
  it('applies the production migration and reads an imported snapshot', async () => {
    const env = storage();
    expect((await post(env, base)).status).toBe(200);
    const response = await worker.fetch(
      new Request('https://api.example/api/snapshot'),
      env,
      context,
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { id: string }).id).toBe(base.id);
  });
  it('accepts an identical retry but rejects changes under the same snapshot ID', async () => {
    const env = storage();
    await post(env, base);
    expect((await post(env, base)).status).toBe(200);
    expect((await post(env, { ...base, warnings: ['Modified'] })).status).toBe(409);
    const row = await env.DB.prepare('SELECT payload FROM snapshots WHERE id = ?')
      .bind(base.id)
      .first<{ payload: string }>();
    expect(JSON.parse(row!.payload).warnings).toEqual(base.warnings);
  });
  it('rejects demo snapshots and snapshots from the future', async () => {
    const env = storage();
    expect((await post(env, { ...base, demo: true })).status).toBe(400);
    expect((await post(env, { ...base, asOf: '2099-01-01T00:00:00.000Z' })).status).toBe(400);
    expect((await env.DB.prepare('SELECT id FROM snapshots').all()).results).toHaveLength(0);
  });
  it('lists historical snapshots in collection order and returns the selected payload', async () => {
    const env = storage();
    await post(env, { ...base, id: 'earlier', asOf: '2026-11-10T12:00:00.000Z' });
    await post(env, { ...base, id: 'later', asOf: '2026-11-11T12:00:00.000Z' });
    const history = await worker.fetch(
      new Request('https://api.example/api/history'),
      env,
      context,
    );
    expect(
      ((await history.json()) as { snapshots: { id: string }[] }).snapshots.map((s) => s.id),
    ).toEqual(['later', 'earlier']);
    const response = await worker.fetch(
      new Request('https://api.example/api/snapshot?id=earlier'),
      env,
      context,
    );
    expect(((await response.json()) as { id: string }).id).toBe('earlier');
  });
  it('enforces a single running refresh across independent lock requests', async () => {
    const env = storage();
    expect(await acquireRefresh(env, 'run-a')).toBe(true);
    expect(await acquireRefresh(env, 'run-b')).toBe(false);
    await env.DB.prepare("UPDATE refresh_runs SET status = 'success' WHERE id = ?")
      .bind('run-a')
      .run();
    expect(await acquireRefresh(env, 'run-b')).toBe(true);
  });
  it('does not re-run the same daily ID after completion', async () => {
    const env = storage();
    expect(await acquireRefresh(env, 'daily-2026-11-13')).toBe(true);
    await env.DB.prepare("UPDATE refresh_runs SET status = 'success' WHERE id = ?")
      .bind('daily-2026-11-13')
      .run();
    expect(await acquireRefresh(env, 'daily-2026-11-13')).toBe(false);
  });
  it('recovers an abandoned lock rather than blocking all future refreshes', async () => {
    const env = storage();
    await env.DB.prepare(
      "INSERT INTO refresh_runs (id, started_at, status) VALUES ('abandoned', '2020-01-01T00:00:00.000Z', 'running')",
    ).run();
    expect(await acquireRefresh(env, 'new-run')).toBe(true);
    const old = await env.DB.prepare(
      "SELECT status FROM refresh_runs WHERE id = 'abandoned'",
    ).first<{ status: string }>();
    expect(old!.status).toBe('failed');
  });
  it('retains the previous stored snapshot after a completely unusable refresh', async () => {
    const env = storage();
    const old = {
      ...base,
      asOf: '2024-01-01T00:00:00.000Z',
      points: [],
      indicators: [],
      documents: [],
    };
    await post(env, old);
    await acquireRefresh(env, 'failing');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await refresh(env, 'failing');
    const response = await worker.fetch(
      new Request('https://api.example/api/snapshot'),
      env,
      context,
    );
    expect(((await response.json()) as { id: string }).id).toBe(base.id);
    const run = await env.DB.prepare("SELECT status FROM refresh_runs WHERE id = 'failing'").first<{
      status: string;
    }>();
    expect(run!.status).toBe('failed');
  });
});
