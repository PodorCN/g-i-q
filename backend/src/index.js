/**
 * g-i-q backend — Cloudflare Worker + KV.
 *
 *   GET  /api/health              liveness + latest as_of
 *   GET  /api/latest              latest full snapshot
 *   GET  /api/history?limit=N     compact time series (consensus, model, every house)
 *   GET  /api/snapshots           list of stored snapshot dates
 *   GET  /api/snapshot/:date      one full snapshot (YYYY-MM-DD)
 *   POST /api/ingest              store a snapshot (Authorization: Bearer $INGEST_TOKEN)
 *
 * The frontend only ever reads; updating the site = POSTing a new snapshot here.
 */

const MAX_BODY = 1_500_000;
const MAX_HISTORY = 520;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      const path = url.pathname.replace(/\/+$/, "") || "/";
      if (request.method === "GET") {
        if (path === "/api/health") return health(env, cors);
        if (path === "/api/latest") return kvJson(env, "snapshot:latest", cors);
        if (path === "/api/history") return history(env, url, cors);
        if (path === "/api/snapshots") return list(env, cors);
        const m = path.match(/^\/api\/snapshot\/(\d{4}-\d{2}-\d{2})$/);
        if (m) return kvJson(env, `snapshot:${m[1]}`, cors, 86400);
      }
      if (request.method === "POST" && path === "/api/ingest") return ingest(request, env, cors);
      return json({ error: "not found" }, 404, cors);
    } catch (err) {
      return json({ error: "internal error", detail: String(err && err.message || err) }, 500, cors);
    }
  },
};

// --------------------------------------------------------------------------- handlers

async function health(env, cors) {
  const idx = (await env.GIQ.get("index", "json")) || [];
  return json({ ok: true, latest: idx[idx.length - 1] || null, count: idx.length }, 200, cors, 0);
}

async function kvJson(env, key, cors, maxAge = 300) {
  const body = await env.GIQ.get(key);
  if (body === null) return json({ error: "no data yet", key }, 404, cors);
  return new Response(body, { headers: { ...cors, ...jsonHeaders(maxAge) } });
}

async function history(env, url, cors) {
  const limit = clampInt(url.searchParams.get("limit"), 1, MAX_HISTORY, 104);
  const hist = (await env.GIQ.get("history", "json")) || [];
  return json({ points: hist.slice(-limit) }, 200, cors);
}

async function list(env, cors) {
  const idx = (await env.GIQ.get("index", "json")) || [];
  return json({ dates: idx }, 200, cors);
}

async function ingest(request, env, cors) {
  if (!env.INGEST_TOKEN) return json({ error: "INGEST_TOKEN not configured" }, 500, cors);
  const auth = request.headers.get("Authorization") || "";
  if (!timingSafeEqual(auth, `Bearer ${env.INGEST_TOKEN}`)) return json({ error: "unauthorized" }, 401, cors);

  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: "payload too large" }, 413, cors);
  let snap;
  try {
    snap = JSON.parse(text);
  } catch {
    return json({ error: "invalid JSON" }, 400, cors);
  }
  const problems = validate(snap);
  if (problems.length) return json({ error: "invalid snapshot", problems }, 422, cors);

  const date = snap.as_of;
  const idx = (await env.GIQ.get("index", "json")) || [];
  const hist = (await env.GIQ.get("history", "json")) || [];

  // A snapshot that carries back-filled model history seeds those months once.
  for (const h of snap.model.history || []) {
    if (!hist.some((p) => p.as_of === h.as_of)) {
      hist.push({ as_of: h.as_of, model: { x: h.x, y: h.y, sx: h.sx, sy: h.sy }, backfill: true });
    }
  }
  const point = compact(snap);
  const at = hist.findIndex((p) => p.as_of === date);
  if (at >= 0) hist[at] = point; else hist.push(point);
  hist.sort((a, b) => a.as_of.localeCompare(b.as_of));

  if (!idx.includes(date)) idx.push(date);
  idx.sort();

  const latestDate = idx[idx.length - 1];
  const writes = [
    env.GIQ.put(`snapshot:${date}`, text),
    env.GIQ.put("index", JSON.stringify(idx)),
    env.GIQ.put("history", JSON.stringify(hist.slice(-MAX_HISTORY))),
  ];
  // Re-ingesting an older date (a correction) must not roll "latest" backwards.
  if (date === latestDate) writes.push(env.GIQ.put("snapshot:latest", text));
  await Promise.all(writes);
  return json({ ok: true, as_of: date, latest: latestDate, views: snap.views.length, history: hist.length }, 200, cors, 0);
}

// --------------------------------------------------------------------------- helpers

function compact(snap) {
  const b = snap.blend.blended;
  const h = snap.blend.houses || {};
  const m = snap.model.point;
  return {
    as_of: snap.as_of,
    consensus: { x: b.x, y: b.y, sx: b.sx, sy: b.sy },
    houses: h.x === undefined ? null : { x: h.x, y: h.y },
    model: { x: m.x, y: m.y, sx: m.sx, sy: m.sy },
    probabilities: b.probabilities,
    views: snap.views.map((v) => ({ id: v.id, x: v.x, y: v.y, stale: !!v.stale })),
  };
}

const num = (v) => typeof v === "number" && Number.isFinite(v);

export function validate(s) {
  const p = [];
  if (!s || typeof s !== "object") return ["body is not an object"];
  if (s.schema_version !== 1) p.push("schema_version must be 1");
  if (typeof s.as_of !== "string" || !DATE_RE.test(s.as_of)) p.push("as_of must be YYYY-MM-DD");
  if (!Array.isArray(s.views)) p.push("views must be an array");
  else s.views.forEach((v, i) => {
    if (!v || typeof v.id !== "string" || typeof v.name !== "string") p.push(`views[${i}] needs id and name`);
    for (const k of ["x", "y", "sx", "sy"]) if (!num(v && v[k])) p.push(`views[${i}].${k} must be a number`);
  });
  const m = s.model && s.model.point;
  if (!m || !["x", "y", "sx", "sy"].every((k) => num(m[k]))) p.push("model.point needs numeric x, y, sx, sy");
  const b = s.blend && s.blend.blended;
  if (!b || !["x", "y", "sx", "sy"].every((k) => num(b[k])) || typeof b.probabilities !== "object") {
    p.push("blend.blended needs numeric x, y, sx, sy and probabilities");
  }
  return p.slice(0, 20);
}

function jsonHeaders(maxAge) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": maxAge ? `public, max-age=${maxAge}, stale-while-revalidate=3600` : "no-store",
  };
}

function json(obj, status, cors, maxAge = 60) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, ...jsonHeaders(status === 200 ? maxAge : 0) } });
}

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get("Origin") || "";
  let allow = "";
  if (allowed.includes("*")) allow = "*";
  else if (allowed.includes(origin)) allow = origin;
  // Cloudflare Pages preview deployments: https://<hash>.<project>.pages.dev
  else if (allowed.some((a) => a.startsWith("https://*.") && origin.endsWith(a.slice(9)))) allow = origin;
  const h = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (allow) h["Access-Control-Allow-Origin"] = allow;
  return h;
}

function clampInt(v, lo, hi, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
}

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
