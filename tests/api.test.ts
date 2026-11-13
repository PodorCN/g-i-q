import { describe, expect, it, vi } from 'vitest';
import worker, { isResearchHour, type Env } from '../backend/index';
import { onRequest } from '../functions/api/[[path]]';

function environment(row: unknown = null): Env {
  const statement = {
    bind: vi.fn(),
    first: vi.fn(async <T>() => row as T | null),
    all: vi.fn(async <T>() => ({ results: [] as T[] })),
    run: vi.fn(async () => ({})),
  };
  statement.bind.mockReturnValue(statement);
  return {
    DB: {
      prepare: vi.fn(() => statement as unknown as ReturnType<Env['DB']['prepare']>),
      batch: vi.fn(),
    },
    ADMIN_TOKEN: 'a-secure-test-token-with-24-characters',
  };
}
const context = { waitUntil: vi.fn() };
describe('Public reads and protected mutations', () => {
  it('does not expose an unprotected refresh endpoint', async () => {
    const env = environment();
    const result = await worker.fetch(
      new Request('https://api.example/api/refresh', { method: 'POST' }),
      env,
      context,
    );
    expect(result.status).toBe(401);
    expect(env.DB.prepare).not.toHaveBeenCalled();
  });
  it('does not accept a short admin secret', async () => {
    const env = { ...environment(), ADMIN_TOKEN: 'short' };
    const result = await worker.fetch(
      new Request('https://api.example/api/refresh', {
        method: 'POST',
        headers: { Authorization: 'Bearer short' },
      }),
      env,
      context,
    );
    expect(result.status).toBe(401);
  });
  it('returns 503 for an empty database instead of a fabricated snapshot', async () => {
    const result = await worker.fetch(
      new Request('https://api.example/api/snapshot'),
      environment(),
      context,
    );
    expect(result.status).toBe(503);
    expect(((await result.json()) as { error: string }).error).toContain('No snapshot');
  });
  it('supports conditional reads and stable ETags', async () => {
    const env = environment({ id: 'test', payload: '{"schemaVersion":1}' });
    const result = await worker.fetch(
      new Request('https://api.example/api/snapshot', { headers: { 'If-None-Match': '"test"' } }),
      env,
      context,
    );
    expect(result.status).toBe(304);
    expect(result.headers.get('ETag')).toBe('"test"');
  });
  it('uses a bound query for historical snapshots', async () => {
    const env = environment();
    await worker.fetch(
      new Request('https://api.example/api/snapshot?id=2026-11-13-abcd'),
      env,
      context,
    );
    expect(env.DB.prepare).toHaveBeenCalledWith('SELECT id, payload FROM snapshots WHERE id = ?');
  });
  it('refuses invalid historical IDs', async () => {
    const result = await worker.fetch(
      new Request('https://api.example/api/snapshot?id=%27%20OR%201%3D1'),
      environment(),
      context,
    );
    expect(result.status).toBe(400);
  });
  it('does not proxy write endpoints through the public Pages frontend', async () => {
    const result = await onRequest({
      request: new Request('https://pages.example/api/refresh', { method: 'POST' }),
      env: { BACKEND_URL: 'https://api.example' },
    });
    expect(result.status).toBe(404);
  });
  it('reports missing Pages API configuration', async () => {
    const result = await onRequest({
      request: new Request('https://pages.example/api/snapshot'),
      env: {},
    });
    expect(result.status).toBe(503);
  });
  it('converts an upstream connection failure to a useful 502', async () => {
    const result = await onRequest({
      request: new Request('https://pages.example/api/snapshot'),
      env: {
        BACKEND: {
          fetch: async () => {
            throw new Error('offline');
          },
        },
      },
    });
    expect(result.status).toBe(502);
  });
});
describe('Daily New York schedule with daylight saving', () => {
  it('runs at 12 UTC in winter and 11 UTC in summer', () => {
    expect(isResearchHour(new Date('2026-11-13T12:00:00Z'))).toBe(true);
    expect(isResearchHour(new Date('2026-11-13T11:00:00Z'))).toBe(false);
    expect(isResearchHour(new Date('2026-07-13T11:00:00Z'))).toBe(true);
    expect(isResearchHour(new Date('2026-07-13T12:00:00Z'))).toBe(false);
  });
});
