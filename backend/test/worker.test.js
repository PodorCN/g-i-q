import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker, { validate } from "../src/index.js";

function memoryKV() {
  const m = new Map();
  return {
    async get(k, type) {
      const v = m.has(k) ? m.get(k) : null;
      return v !== null && type === "json" ? JSON.parse(v) : v;
    },
    async put(k, v) { m.set(k, v); },
    _m: m,
  };
}

const snap = JSON.parse(readFileSync(new URL("../../data/latest.json", import.meta.url)));
const env = () => ({ GIQ: memoryKV(), INGEST_TOKEN: "t0ken", ALLOWED_ORIGINS: "https://giq.pages.dev" });
const req = (path, init) => new Request(`https://api.test${path}`, init);
const post = (body, token = "t0ken") => req("/api/ingest", {
  method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
});

test("seed snapshot validates", () => assert.deepEqual(validate(snap), []));

test("latest is 404 before any ingest", async () => {
  const r = await worker.fetch(req("/api/latest"), env());
  assert.equal(r.status, 404);
});

test("ingest requires the bearer token", async () => {
  const r = await worker.fetch(post(snap, "nope"), env());
  assert.equal(r.status, 401);
});

test("ingest rejects malformed snapshots", async () => {
  const r = await worker.fetch(post({ schema_version: 1, as_of: "x", views: [{}] }), env());
  assert.equal(r.status, 422);
  assert.ok((await r.json()).problems.length > 0);
});

test("ingest -> latest, history, snapshot", async () => {
  const e = env();
  const r = await worker.fetch(post(snap), e);
  assert.equal(r.status, 200);
  const latest = await (await worker.fetch(req("/api/latest"), e)).json();
  assert.equal(latest.as_of, snap.as_of);
  const hist = (await (await worker.fetch(req("/api/history"), e)).json()).points;
  assert.equal(hist.at(-1).as_of, snap.as_of);
  assert.equal(hist.at(-1).views.length, snap.views.length);
  assert.ok(hist.filter((p) => p.backfill).length >= 12, "model backfill seeded");
  const one = await worker.fetch(req(`/api/snapshot/${snap.as_of}`), e);
  assert.equal(one.status, 200);
});

test("older snapshot does not replace latest", async () => {
  const e = env();
  await worker.fetch(post(snap), e);
  await worker.fetch(post({ ...snap, as_of: "2026-01-02" }), e);
  const latest = await (await worker.fetch(req("/api/latest"), e)).json();
  assert.equal(latest.as_of, snap.as_of);
  const dates = (await (await worker.fetch(req("/api/snapshots"), e)).json()).dates;
  assert.deepEqual(dates, ["2026-01-02", snap.as_of]);
});

test("CORS echoes only allowed origins", async () => {
  const ok = await worker.fetch(req("/api/health", { headers: { Origin: "https://giq.pages.dev" } }), env());
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), "https://giq.pages.dev");
  const bad = await worker.fetch(req("/api/health", { headers: { Origin: "https://evil.example" } }), env());
  assert.equal(bad.headers.get("Access-Control-Allow-Origin"), null);
});
