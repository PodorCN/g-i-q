// g-i-q frontend: Growth-Inflation Quadrant interactive dashboard.
import {
  ALL_QUADRANTS,
  quadrantOf,
  allowedQuadrants,
  singleComponentPolygons,
  mixtureHdrPolygons,
  polygonsToSvgPath,
} from "./regions.js";

const SVGNS = "http://www.w3.org/2000/svg";
const QUAD_NAMES = {
  goldilocks: "Goldilocks",
  overheating: "Overheating",
  stagflation: "Stagflation",
  slowdown: "Disinflationary slowdown",
};
const QUAD_SUBS = {
  goldilocks: "g↑ π↓ · benign / dovish",
  overheating: "g↑ π↑ · hawkish bias",
  stagflation: "g↓ π↑ · sticky prices + drag",
  slowdown: "g↓ π↓ · recessionary / cuts",
};
const QUAD_SIGNS = {
  goldilocks: "g↑ π↓",
  overheating: "g↑ π↑",
  stagflation: "g↓ π↑",
  slowdown: "g↓ π↓",
};
const QUAD_COLOR_VAR = {
  goldilocks: "--q-goldilocks",
  overheating: "--q-overheating",
  stagflation: "--q-stagflation",
  slowdown: "--q-slowdown",
};
const TYPE_LABEL = { sell_side: "Sell-side bank", buy_side: "Asset manager", official: "Official sector" };
const TYPE_VAR = { sell_side: "--sell", buy_side: "--buy", official: "--official" };
const HOUSE_COLORS = {
  gsam: "#0ea5e9",
  blackrock: "#f97316",
  pimco: "#a855f7",
  vanguard: "#d99b07",
  usbank: "#3b82f6",
  wells: "#ec4899",
  ms: "#14b8a6",
  fed_board: "#10b981",
  jpm: "#ef4444",
  bofa: "#7cb305",
  gs_research: "#6366f1",
  schwab: "#f43f5e",
};
const PALETTE_FALLBACK = ["#0ea5e9", "#f97316", "#a855f7", "#d99b07", "#3b82f6", "#ec4899", "#14b8a6", "#10b981", "#ef4444", "#7cb305"];
const CONF_RANK = { high: 3, medium: 2, low: 1 };

const state = {
  snap: null,
  history: [],
  basis: "houses",
  zoom: "cluster",
  ci: "0.68",
  allEllipses: false,
  arrows: true,
  trail: true,
  showStale: true,
  selected: "houses",
  hover: null,
  filterQuad: null,
  filterType: null,
  detailMode: "inspect",
  compareA: "houses",
  compareB: "data_model",
  indFilter: "all",
  expandedInds: new Set(),
  viewsFilter: "all",
  viewsSearch: "",
  viewsSort: { key: "y", dir: -1 },
  replayIdx: null,
  replayTimer: null,
};

// ------------------------------------------------------------------ utils

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(2)) {
    if (c !== null && c !== undefined && c !== false) {
      n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }
  return n;
}

function svg(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c) n.append(c);
  return n;
}

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fmt = (v, d = 2) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(d);
const pct = (v) => `${Math.round((v || 0) * 100)}%`;
const safeUrl = (u) => {
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:" ? x.href : null;
  } catch {
    return null;
  }
};
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

function paramsOf() {
  const p = state.snap?.params || {};
  return { trend: p.trend_growth ?? 2.0, target: p.inflation_target ?? 2.0, share: p.model_weight_share ?? 0.4 };
}

function impliedLevels(x, y) {
  const { trend, target } = paramsOf();
  return { gdp: trend + x, pce: target + y };
}

function colorOf(p) {
  if (p.kind === "view") {
    if (HOUSE_COLORS[p.key]) return HOUSE_COLORS[p.key];
    let h = 0;
    for (let i = 0; i < p.key.length; i++) h = (h * 31 + p.key.charCodeAt(i)) >>> 0;
    return PALETTE_FALLBACK[h % PALETTE_FALLBACK.length];
  }
  return css("--ink");
}

function keyCallText(v) {
  const nums = (v.forecast_numbers || []).slice(0, 2).map((f) => `${f.metric}: ${f.value}`);
  if (nums.length) return nums.join(" · ");
  if (v.key_points?.length) return v.key_points[0];
  return (v.summary || "").slice(0, 72);
}

// ------------------------------------------------------------------ data & replay

function apiBase() {
  const q = new URLSearchParams(location.search).get("api");
  const base = q || (window.GIQ_CONFIG && window.GIQ_CONFIG.apiBase) || "";
  return base.replace(/\/+$/, "");
}

async function load() {
  const base = apiBase();
  const [latest, hist] = await Promise.all([
    fetch(`${base}/api/latest`).then((r) => { if (!r.ok) throw new Error(`/api/latest → HTTP ${r.status}`); return r.json(); }),
    fetch(`${base}/api/history?limit=260`).then((r) => (r.ok ? r.json() : { points: [] })).catch(() => ({ points: [] })),
  ]);
  state.snap = latest;
  state.history = (hist.points || []).slice().sort((a, b) => a.as_of.localeCompare(b.as_of));
}

function timelineEntries() {
  const byDate = new Map();
  for (const h of state.snap?.model?.history || []) {
    byDate.set(h.as_of, { as_of: h.as_of, model: { x: h.x, y: h.y, sx: h.sx, sy: h.sy }, backfill: true });
  }
  for (const h of state.history) {
    byDate.set(h.as_of, h);
  }
  if (state.snap) {
    const s = state.snap;
    if (!byDate.has(s.as_of)) {
      byDate.set(s.as_of, {
        as_of: s.as_of,
        consensus: s.blend.blended,
        houses: s.blend.houses,
        model: s.model.point,
        probabilities: s.blend.blended.probabilities,
        views: s.views.map((v) => ({ id: v.id, x: v.x, y: v.y, stale: !!v.stale })),
      });
    }
  }
  return [...byDate.values()].sort((a, b) => a.as_of.localeCompare(b.as_of));
}

function activeSnapshotView() {
  const s = state.snap;
  const entries = timelineEntries();
  if (state.replayIdx === null || !entries.length) {
    return { asOf: s.as_of, isReplay: false, backfillOnly: false, views: s.views, modelPt: s.model.point, blend: s.blend };
  }
  const h = entries[Math.max(0, Math.min(entries.length - 1, state.replayIdx))];
  if (h.as_of === s.as_of) {
    return { asOf: s.as_of, isReplay: false, backfillOnly: false, views: s.views, modelPt: s.model.point, blend: s.blend };
  }
  if (h.backfill || !h.views) {
    const mp = {
      ...s.model.point,
      x: h.model.x, y: h.model.y, sx: h.model.sx, sy: h.model.sy,
      dx: 0, dy: 0, quadrant: quadrantOf(h.model.x, h.model.y),
      plausible_quadrants: [quadrantOf(h.model.x, h.model.y)],
    };
    return {
      asOf: h.as_of, isReplay: true, backfillOnly: true,
      views: [], modelPt: mp,
      blend: { model: { ...mp, probabilities: { [mp.quadrant]: 1 } }, houses: null, blended: { ...mp, probabilities: { [mp.quadrant]: 1 } }, model_weight_share: 1 },
    };
  }
  const viewById = new Map(s.views.map((v) => [v.id, v]));
  const views = h.views.map((hv) => {
    const base = viewById.get(hv.id) || { id: hv.id, name: hv.id, short: hv.id, type: "sell_side", sx: 0.5, sy: 0.5, weight: 0.8 };
    return { ...base, x: hv.x, y: hv.y, stale: !!hv.stale, quadrant: quadrantOf(hv.x, hv.y) };
  });
  const mp = h.model ? {
    ...s.model.point, x: h.model.x, y: h.model.y, sx: h.model.sx, sy: h.model.sy,
    quadrant: quadrantOf(h.model.x, h.model.y),
  } : s.model.point;
  const b = h.consensus ? { ...s.blend.blended, ...h.consensus, probabilities: h.probabilities || s.blend.blended.probabilities } : s.blend.blended;
  const hs = h.houses ? { ...s.blend.houses, ...h.houses } : s.blend.houses;
  return {
    asOf: h.as_of, isReplay: true, backfillOnly: false,
    views, modelPt: mp,
    blend: { ...s.blend, blended: b, houses: hs },
  };
}

function points() {
  const act = activeSnapshotView();
  const views = act.views.filter((v) => state.showStale || !v.stale);
  const m = act.modelPt;
  const pts = [
    ...views.map((v) => ({
      kind: "view", key: v.id, label: v.short || v.name, name: v.name, type: v.type,
      x: v.x, y: v.y, sx: v.sx, sy: v.sy, dx: v.dx, dy: v.dy, stale: !!v.stale,
      plausible_quadrants: v.plausible_quadrants, src: v,
    })),
    {
      kind: "model", key: "data_model", label: "Hard data", name: m.name, type: "model",
      x: m.x, y: m.y, sx: m.sx, sy: m.sy, dx: m.dx, dy: m.dy,
      plausible_quadrants: m.plausible_quadrants, src: m,
    },
  ];
  if (!act.backfillOnly && act.blend.houses) {
    const hs = act.blend.houses;
    pts.push({
      kind: "consensus", key: "houses", label: "Houses", name: "Houses consensus", type: "consensus",
      x: hs.x, y: hs.y, sx: hs.sx, sy: hs.sy, plausible_quadrants: hs.plausible_quadrants, src: hs,
    });
  }
  return pts;
}

function pointMatchesFilter(p) {
  if (state.filterQuad && quadrantOf(p.x, p.y) !== state.filterQuad) return false;
  if (state.filterType && p.type !== state.filterType) return false;
  return true;
}

function mixtureComponentsFor(kind) {
  const act = activeSnapshotView();
  const views = act.views;
  const m = act.modelPt;
  const vComps = views.map((v) => ({
    x: v.x, sx: v.sx, y: v.y, sy: v.sy, w: v.weight || 0.8,
    plausible_quadrants: v.plausible_quadrants,
  }));
  if (kind === "houses") return vComps;
  const share = act.blend.model_weight_share ?? 0.4;
  const wsum = vComps.reduce((s, c) => s + c.w, 0) || 1;
  return [
    ...vComps.map((c) => ({ ...c, w: (c.w / wsum) * (1 - share) })),
    { x: m.x, sx: m.sx, y: m.y, sy: m.sy, w: share, plausible_quadrants: m.plausible_quadrants },
  ];
}

// ------------------------------------------------------------------ hero & yardstick

function fmtDateTime(iso) {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const utc = iso.replace("T", " ").replace("+00:00", " UTC");
  return `${local} local (${utc})`;
}

function shortDate(d) {
  return d && d.length >= 10 ? `${d.slice(5, 7)}/${d.slice(8, 10)}` : "";
}

function modelDateStats() {
  const dates = (state.snap?.model?.indicators || []).map((r) => r.observation_date).filter(Boolean).sort();
  return { earliest: dates[0] || "n.d.", latest: dates.at(-1) || "n.d." };
}

function renderHero() {
  const s = state.snap;
  const act = activeSnapshotView();
  const views = s.views || [];
  const staleN = views.filter((v) => v.stale).length;
  const missingN = Math.max(0, (s.sources?.length || views.length) - views.length);
  const newestPub = views.map((v) => v.published).filter(Boolean).sort().at(-1) || "n.d.";
  const fredDates = modelDateStats();

  document.getElementById("asof").textContent = act.isReplay
    ? `Replay: ${act.asOf}${act.backfillOnly ? " (hard-data backfill)" : " (historical snapshot)"}`
    : `Dashboard updated: ${fmtDateTime(s.generated_at)} · Snapshot as of ${s.as_of}`;

  const fp = document.getElementById("freshness-summary");
  fp.hidden = false;
  fp.className = `freshness-pill${staleN || missingN ? " warn" : ""}`;
  fp.textContent = `Houses latest: ${newestPub} · FRED latest: ${fredDates.latest} · ${views.length}/${s.sources?.length || views.length} houses (${staleN} stale)`;

  document.getElementById("footer-gen").textContent = `Dashboard generated ${fmtDateTime(s.generated_at)}`;

  for (const span of document.querySelectorAll("[data-param]")) {
    const v = s.params?.[span.dataset.param];
    span.textContent = v === undefined ? "?" : span.hasAttribute("data-pct") ? pct(v) : String(v);
  }

  renderHeadlineAndTiles(act);
  renderYardstick(act);
}

function renderHeadlineAndTiles(act) {
  const basisObj = state.basis === "model" ? act.blend.model : (act.blend.houses || act.blend.model);
  const probs = basisObj.probabilities || {};
  const top = Object.keys(probs).reduce((a, b) => ((probs[a] ?? 0) >= (probs[b] ?? 0) ? a : b));
  const { gdp, pce } = impliedLevels(basisObj.x, basisObj.y);
  const basisLabel = state.basis === "model" ? "hard data" : "house consensus";

  document.getElementById("headline").textContent =
    `${QUAD_NAMES[top]} (${pct(probs[top] || 0)} ${basisLabel}) — implied ${gdp.toFixed(1)}% real GDP, ${pce.toFixed(1)}% core PCE`;

  const h = act.blend.houses;
  const m = act.modelPt;
  let sub = "";
  if (act.backfillOnly) {
    sub = `Viewing historical hard-data backfill on ${act.asOf}: growth gap ${fmt(m.x)}pp, inflation gap ${fmt(m.y)}pp.`;
  } else if (state.basis === "model") {
    const gUp = state.snap.model.indicators.filter((r) => r.axis === "growth" && r.supports === "above_trend").length;
    const pUp = state.snap.model.indicators.filter((r) => r.axis === "inflation" && r.supports === "above_target").length;
    sub = `${gUp} of 9 growth indicators sit above trend and ${pUp} of 7 inflation indicators above target; Wall Street consensus sits ${Math.abs((h?.x ?? m.x) - m.x).toFixed(2)}pp ${(h?.x ?? m.x) < m.x ? "cooler" : "hotter"} on growth.`;
  } else if (h) {
    const diffG = h.x - m.x;
    const tailCount = act.views.filter((v) => (v.plausible_quadrants || []).length > 1 || v.quadrant !== top).length;
    sub = `Hard data (${fmt(m.x)}pp growth / ${fmt(m.y)}pp infl) runs ${Math.abs(diffG).toFixed(2)}pp ${diffG < 0 ? "hotter" : "cooler"} on growth than Wall Street (${fmt(h.x)} / ${fmt(h.y)}); ${tailCount} of ${act.views.length} houses flag downside or off-base regime risk.`;
  }
  document.getElementById("subheadline").textContent = sub;

  const order = ["goldilocks", "overheating", "slowdown", "stagflation"];
  const box = document.getElementById("tiles");
  const countIn = (q) => {
    const hv = act.views.filter((v) => (state.showStale || !v.stale) && quadrantOf(v.x, v.y) === q).length;
    const hasM = quadrantOf(m.x, m.y) === q;
    if (state.basis === "model") return hasM ? "Hard data sits here" : "—";
    return hv ? `${hv} house${hv > 1 ? "s" : ""}` : "0 houses";
  };

  box.replaceChildren(...order.map((q) => {
    const isTop = q === top;
    const active = state.filterQuad === q;
    const dimmed = state.filterQuad && !active;
    return el("button", {
      type: "button",
      class: `tile${isTop ? " top" : ""}${active ? " active-filter" : ""}${dimmed ? " dimmed" : ""}`,
      style: `--q-color: var(${QUAD_COLOR_VAR[q]})`,
      "aria-pressed": String(active),
      onclick: () => {
        state.filterQuad = state.filterQuad === q ? null : q;
        syncClearFiltersBtn();
        renderTilesOnly();
        applyFocus();
      },
    },
      el("div", { class: "q" }, el("span", { text: QUAD_NAMES[q] }), el("span", { class: "sig", text: QUAD_SIGNS[q] })),
      el("div", { class: "q-sub", text: QUAD_SUBS[q] }),
      el("div", { class: "tile-row" },
        el("span", { class: "p", text: pct(probs[q] || 0) }),
        el("span", { class: "cnt", text: countIn(q) })),
      el("div", { class: "bar", "aria-hidden": "true" }, el("span", { style: `width:${(probs[q] || 0) * 100}%` })));
  }));
}

function renderTilesOnly() {
  renderHeadlineAndTiles(activeSnapshotView());
}

function renderYardstick(act) {
  const { trend, target } = paramsOf();
  const box = document.getElementById("yardstick");
  const m = act.modelPt;
  const h = act.blend.houses;
  const freshViews = act.views.filter((v) => !v.stale);
  const pool = freshViews.length ? freshViews : act.views;

  document.getElementById("yardstick-note").textContent =
    `Trend GDP = ${trend.toFixed(1)}% · Fed Core PCE target = ${target.toFixed(1)}%`;

  const axes = [
    {
      title: "Real GDP growth (6–12m)",
      bench: trend,
      benchLabel: `Trend ${trend.toFixed(1)}%`,
      lo: 1.0, hi: 3.6,
      val: (pt) => trend + pt.x,
      gap: (pt) => pt.x,
      range: pool.length ? [Math.min(...pool.map((v) => trend + v.x)), Math.max(...pool.map((v) => trend + v.x))] : null,
    },
    {
      title: "Core PCE inflation (6–12m)",
      bench: target,
      benchLabel: `Target ${target.toFixed(1)}%`,
      lo: 1.4, hi: 3.8,
      val: (pt) => target + pt.y,
      gap: (pt) => pt.y,
      range: pool.length ? [Math.min(...pool.map((v) => target + v.y)), Math.max(...pool.map((v) => target + v.y))] : null,
    },
  ];

  const pos = (v, lo, hi) => Math.max(3, Math.min(97, ((v - lo) / (hi - lo)) * 100));

  box.replaceChildren(...axes.map((ax) => {
    const items = [];
    if (h) items.push({ key: "houses", label: "Houses", v: ax.val(h), g: ax.gap(h), cls: "houses" });
    items.push({ key: "data_model", label: "Hard data", v: ax.val(m), g: ax.gap(m), cls: "model" });

    const trackKids = [
      el("span", { class: "ys-bench", style: `left:${pos(ax.bench, ax.lo, ax.hi)}%` }),
      el("span", { class: "ys-bench-lbl", style: `left:${pos(ax.bench, ax.lo, ax.hi)}%`, text: ax.benchLabel }),
    ];
    if (ax.range) {
      const r0 = pos(ax.range[0], ax.lo, ax.hi), r1 = pos(ax.range[1], ax.lo, ax.hi);
      trackKids.push(el("span", { class: "ys-range", style: `left:${r0}%;width:${Math.max(2, r1 - r0)}%`, title: `Fresh houses span ${ax.range[0].toFixed(2)}% – ${ax.range[1].toFixed(2)}%` }));
    }
    for (const it of items) {
      trackKids.push(el("button", {
        type: "button",
        class: `ys-dot ${it.cls}`,
        style: `left:${pos(it.v, ax.lo, ax.hi)}%`,
        title: `${it.label}: ${it.v.toFixed(2)}% (${fmt(it.g)}pp)`,
        "aria-label": `${it.label}: ${it.v.toFixed(2)}%`,
        onclick: () => select(it.key),
      }));
    }

    return el("div", { class: "ys-row" },
      el("div", { class: "ys-head" },
        el("span", { class: "ys-title", text: ax.title }),
        el("span", { class: "ys-vals", text: items.map((it) => `${it.label} ${it.v.toFixed(2)}% (${fmt(it.g, 2)})`).join(" · ") })),
      el("div", { class: "ys-track" }, ...trackKids),
      el("div", { class: "ys-legend" },
        el("span", {}, el("span", { class: "ys-swatch", style: "background:var(--sell)" }), "Houses"),
        el("span", {}, el("span", { class: "ys-swatch model" }), "Hard data"),
        ax.range ? el("span", { class: "muted", text: `Fresh range ${ax.range[0].toFixed(1)}–${ax.range[1].toFixed(1)}%` }) : null));
  }));
}

// ------------------------------------------------------------------ chart

function niceDomain(vals, minSpan, step = 0.5) {
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < minSpan) {
    const c = (hi + lo) / 2;
    lo = c - minSpan / 2;
    hi = c + minSpan / 2;
  }
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  return [lo, hi];
}

function markerPath(type, r) {
  switch (type) {
    case "buy_side": return `M${-r},${-r}h${2 * r}v${2 * r}h${-2 * r}z`;
    case "official": { const h = r * 1.25; return `M0,${-h}L${h},${h * 0.8}L${-h},${h * 0.8}z`; }
    case "model": { const h = r * 1.35; return `M0,${-h}L${h},0L0,${h}L${-h},0z`; }
    default: return `M${-r},0a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
  }
}

function renderLegend() {
  const items = [
    ["sell_side", TYPE_LABEL.sell_side],
    ["buy_side", TYPE_LABEL.buy_side],
    ["official", TYPE_LABEL.official],
    ["model", "Hard data (point)"],
    ["consensus", "Houses consensus"],
  ];
  const ink2 = css("--ink-2");
  const ink = css("--ink");
  const trailIcon = svg("svg", { width: 18, height: 12, viewBox: "0 0 18 12", "aria-hidden": "true" },
    svg("line", { x1: 1, y1: 6, x2: 17, y2: 6, stroke: ink2, "stroke-width": 1.5, "stroke-dasharray": "2 2" }),
    svg("circle", { cx: 9, cy: 6, r: 2.3, fill: ink2 }));

  document.getElementById("legend").replaceChildren(
    ...items.map(([t, label]) => {
      const color = t in TYPE_VAR ? ink2 : ink;
      const icon = svg("svg", { width: 13, height: 13, viewBox: "-7 -7 14 14", "aria-hidden": "true" },
        t === "consensus"
          ? svg("circle", { r: 4.8, fill: "none", stroke: color, "stroke-width": 2 })
          : svg("path", { d: markerPath(t, 4.3), fill: color }));
      const active = state.filterType === t;
      const dimmed = state.filterType && !active;
      return el("li", {},
        el("button", {
          type: "button",
          class: `${active ? "active" : ""}${dimmed ? " dim" : ""}`,
          "aria-pressed": String(active),
          onclick: () => {
            state.filterType = state.filterType === t ? null : t;
            syncClearFiltersBtn();
            renderLegend();
            applyFocus();
          },
        }, icon, label));
    }),
    el("li", {},
      el("button", {
        type: "button",
        class: state.trail ? "" : "dim",
        "aria-pressed": String(state.trail),
        title: "Toggle 18-month Hard data path",
        onclick: () => {
          state.trail = !state.trail;
          document.getElementById("opt-trail").checked = state.trail;
          renderLegend();
          renderChart();
        },
      }, trailIcon, "Hard data path (18m)")),
    el("li", { class: "legend-note", text: "Shape = type · Color = house" }),
  );
}

function trailSeries() {
  const s = state.snap;
  const act = activeSnapshotView();
  const cutoff = act.asOf;
  const byDate = new Map();
  for (const h of s.model.history || []) {
    if (h.as_of <= cutoff) byDate.set(h.as_of, { as_of: h.as_of, x: h.x, y: h.y });
  }
  for (const h of state.history) {
    if (h.model && h.as_of <= cutoff) byDate.set(h.as_of, { as_of: h.as_of, x: h.model.x, y: h.model.y });
  }
  if (!act.isReplay) byDate.set(s.as_of, { as_of: s.as_of, x: s.model.point.x, y: s.model.point.y });
  const model = [...byDate.values()].sort((a, b) => a.as_of.localeCompare(b.as_of)).slice(-18);
  const housesTrail = state.history
    .filter((h) => h.houses && !h.backfill && h.as_of <= cutoff)
    .map((h) => ({ as_of: h.as_of, x: h.houses.x, y: h.houses.y }));
  if (!act.isReplay && s.blend.houses && !housesTrail.some((c) => c.as_of === s.as_of)) {
    housesTrail.push({ as_of: s.as_of, x: s.blend.houses.x, y: s.blend.houses.y });
  }
  return [model, housesTrail.slice(-26)];
}

function computeAllRegions(pts) {
  const pLevel = Number(state.ci);
  const out = new Map();
  for (const p of pts) {
    if (p.kind !== "view") continue; // Only individual houses render uncertainty clouds; Houses & Hard data are clean reference points
    out.set(p.key, singleComponentPolygons(p, pLevel));
  }
  return out;
}

function setHoverBar(contentNodes) {
  const bar = document.getElementById("hover-bar");
  bar.replaceChildren(...contentNodes);
}

function defaultHoverBarNodes() {
  return [
    el("span", { class: "hb-main idle", text: "Hover or click any point, label, or cloud — click again or empty space to reset." }),
    el("span", { class: "hb-meta", text: "Dotted line = 18-month Hard data path (click any dot on the path to replay that month)." }),
  ];
}

function renderChart() {
  const host = document.getElementById("chart");
  const W = Math.max(320, host.clientWidth || 780);
  const narrow = W < 540;
  const H = Math.round(Math.min(600, Math.max(narrow ? 340 : 420, W * (narrow ? 1.02 : 0.68))));
  const m = { t: 18, r: 18, b: 42, l: 48 };
  const pts = points();
  const regions = computeAllRegions(pts);

  // Domain calculation
  let xs, ys;
  if (state.zoom === "cluster") {
    xs = pts.flatMap((p) => [p.x - 0.35, p.x + 0.35]);
    ys = pts.flatMap((p) => [p.y - 0.32, p.y + 0.32]);
    // Include origin edges softly if points are near 0 so quadrant boundary stays visible
    if (Math.min(...xs) > -0.25 && Math.min(...xs) < 0.45) xs.push(-0.2);
    if (Math.max(...xs) < 0.25 && Math.max(...xs) > -0.45) xs.push(0.2);
    if (Math.min(...ys) > -0.25 && Math.min(...ys) < 0.75) ys.push(-0.1);
    if (Math.max(...ys) < 0.25 && Math.max(...ys) > -0.45) ys.push(0.2);
    // Include active/houses region bbox softly (capped so giant clouds don't crush cluster)
    const focusKey = state.selected;
    const reg = regions.get(focusKey) || regions.get("houses");
    if (reg) {
      for (const poly of reg.polygons) {
        for (const [ux, vy] of poly) {
          if (Math.abs(ux) < 2.4 && Math.abs(vy) < 2.6) { xs.push(ux); ys.push(vy); }
        }
      }
    }
  } else {
    xs = [...pts.flatMap((p) => [p.x - 0.6, p.x + 0.6]), -1.0, 1.5];
    ys = [...pts.flatMap((p) => [p.y - 0.6, p.y + 0.6]), -0.8, 1.6];
    if (state.trail) for (const h of trailSeries().flat()) { xs.push(h.x); ys.push(h.y); }
    for (const reg of regions.values()) {
      for (const poly of reg.polygons) {
        for (const [ux, vy] of poly) { xs.push(ux); ys.push(vy); }
      }
    }
  }

  const [x0, x1] = niceDomain(xs, state.zoom === "cluster" ? 1.5 : 2.5, 0.5);
  const [y0, y1] = niceDomain(ys, state.zoom === "cluster" ? 1.4 : 2.4, 0.5);
  const X = (v) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const sxPx = (v) => (v / (x1 - x0)) * (W - m.l - m.r);
  const syPx = (v) => (v / (y1 - y0)) * (H - m.t - m.b);

  // Zoom locator badge
  const zBadge = document.getElementById("zoom-badge");
  if (state.zoom === "cluster") {
    const visibleQuads = [];
    if (x1 > 0 && y0 < 0) visibleQuads.push("Goldilocks");
    if (x1 > 0 && y1 > 0) visibleQuads.push("Overheating");
    if (x0 < 0 && y1 > 0) visibleQuads.push("Stagflation");
    if (x0 < 0 && y0 < 0) visibleQuads.push("Slowdown");
    zBadge.hidden = false;
    zBadge.textContent = `Zoomed: ${visibleQuads.join(" / ")}`;
  } else {
    zBadge.hidden = true;
  }

  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Growth-inflation quadrant scatter plot" });
  const ink2 = css("--ink-2"), muted = css("--muted"), gridC = css("--grid"), axisC = css("--axis"), surface = css("--surface");

  root.append(svg("defs", {}, svg("clipPath", { id: "plot-clip" }, svg("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b }))));

  // Subtle quadrant washes inside plot
  const qBg = svg("g", { "clip-path": "url(#plot-clip)" });
  const drawQBg = (q, qx0, qx1, qy0, qy1) => {
    const ix0 = Math.max(x0, qx0), ix1 = Math.min(x1, qx1);
    const iy0 = Math.max(y0, qy0), iy1 = Math.min(y1, qy1);
    if (ix1 <= ix0 || iy1 <= iy0) return;
    qBg.append(svg("rect", {
      x: X(ix0), y: Y(iy1), width: X(ix1) - X(ix0), height: Y(iy0) - Y(iy1),
      fill: css(QUAD_COLOR_VAR[q]), "fill-opacity": 0.04,
    }));
  };
  drawQBg("overheating", 0, x1, 0, y1);
  drawQBg("stagflation", x0, 0, 0, y1);
  drawQBg("goldilocks", 0, x1, y0, 0);
  drawQBg("slowdown", x0, 0, y0, 0);
  root.append(qBg);

  const grid = svg("g");
  const stepX = x1 - x0 <= 2.5 ? 0.5 : 0.5;
  const stepY = y1 - y0 <= 2.5 ? 0.5 : 0.5;
  for (let v = Math.ceil(x0 * 2) / 2; v <= x1 + 1e-9; v += stepX) {
    if (Math.abs(v) < 1e-9) continue;
    const major = Math.abs(v % 1) < 1e-9 || x1 - x0 <= 2.5;
    grid.append(svg("line", { x1: X(v), x2: X(v), y1: m.t, y2: H - m.b, stroke: gridC, "stroke-width": Math.abs(v % 1) < 1e-9 ? 1 : 0.5 }));
    if (major) grid.append(svg("text", { x: X(v), y: H - m.b + 15, "text-anchor": "middle", "font-size": 11, fill: muted, text: fmt(v, Math.abs(v % 1) < 1e-9 ? 0 : 1) }));
  }
  for (let v = Math.ceil(y0 * 2) / 2; v <= y1 + 1e-9; v += stepY) {
    if (Math.abs(v) < 1e-9) continue;
    const major = Math.abs(v % 1) < 1e-9 || y1 - y0 <= 2.5;
    grid.append(svg("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: gridC, "stroke-width": Math.abs(v % 1) < 1e-9 ? 1 : 0.5 }));
    if (major) grid.append(svg("text", { x: m.l - 7, y: Y(v) + 4, "text-anchor": "end", "font-size": 11, fill: muted, text: fmt(v, Math.abs(v % 1) < 1e-9 ? 0 : 1) }));
  }

  // Zero axes (draw whenever within or near plot)
  if (x0 <= 0 && x1 >= 0) {
    grid.append(svg("line", { x1: X(0), x2: X(0), y1: m.t, y2: H - m.b, stroke: axisC, "stroke-width": 1.6 }));
    grid.append(svg("text", { x: X(0), y: H - m.b + 15, "text-anchor": "middle", "font-size": 11, "font-weight": 650, fill: ink2, text: "0" }));
  }
  if (y0 <= 0 && y1 >= 0) {
    grid.append(svg("line", { x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0), stroke: axisC, "stroke-width": 1.6 }));
    grid.append(svg("text", { x: m.l - 7, y: Y(0) + 4, "text-anchor": "end", "font-size": 11, "font-weight": 650, fill: ink2, text: "0" }));
  }

  // Axis titles
  const { trend, target } = paramsOf();
  grid.append(svg("text", { x: W - m.r, y: H - 7, "text-anchor": "end", "font-size": 11.5, fill: ink2, text: `Growth vs ${trend.toFixed(1)}% trend (pp) →` }));
  grid.append(svg("text", { x: 13, y: m.t, "text-anchor": "start", "font-size": 11.5, fill: ink2, transform: `rotate(-90 13 ${m.t}) translate(${-(H - m.t - m.b)} 0)`, text: `Core PCE vs ${target.toFixed(1)}% target (pp) →` }));

  // Visible quadrant labels
  const qLabel = (q, x, y, anchor) => grid.append(svg("text", {
    x, y, "text-anchor": anchor, "font-size": narrow ? 10 : 11, "font-weight": 700,
    fill: css(QUAD_COLOR_VAR[q]), "fill-opacity": 0.78, "letter-spacing": "0.06em",
    text: (narrow && q === "slowdown" ? "Slowdown" : QUAD_NAMES[q]).toUpperCase(),
  }));
  if (x0 < 0 && y1 > 0) qLabel("stagflation", m.l + 9, m.t + 16, "start");
  if (x1 > 0 && y1 > 0) qLabel("overheating", W - m.r - 9, m.t + 16, "end");
  if (x0 < 0 && y0 < 0) qLabel("slowdown", m.l + 9, H - m.b - 9, "start");
  if (x1 > 0 && y0 < 0) qLabel("goldilocks", W - m.r - 9, H - m.b - 9, "end");
  root.append(grid);

  // Unified quadrant-constrained regions: soft Gaussian gradient clouds for houses
  const rDefs = svg("defs");
  const rg = svg("g", { class: "regions", "clip-path": "url(#plot-clip)" });
  const rlg = svg("g", { class: "region-labels", "clip-path": "url(#plot-clip)" });
  const pLevel = Number(state.ci);
  const stdK = pLevel >= 0.89 ? 2.15 : 1.52;

  // Draw widest/stalest clouds underneath and sharpest/primary ones on top
  const regOrder = [...pts].sort((a, b) => {
    const ka = a.kind === "view" ? 0 : 1;
    const kb = b.kind === "view" ? 0 : 1;
    if (ka !== kb) return ka - kb;
    return (b.sx * b.sy) - (a.sx * a.sy);
  });

  for (const p of regOrder) {
    const reg = regions.get(p.key);
    if (!reg || !reg.polygons.length) continue;
    const c = colorOf(p);
    const dPath = polygonsToSvgPath(reg.polygons, X, Y);
    if (!dPath) continue;

    // Radial Gaussian gradient centered at (X(p.x), Y(p.y)), scaled to confidence semi-axes
    const gradId = `rgrad-${p.key}`;
    const rFactor = reg.radius || stdK * 1.15;
    const rxPx = Math.max(8, sxPx(p.sx * rFactor));
    const ryPx = Math.max(8, syPx(p.sy * rFactor));
    const spreadArea = p.sx * p.sy;
    const sharpness = Math.max(0.32, Math.min(1.0, 0.24 / Math.max(spreadArea, 0.12)));
    const staleMul = p.stale ? 0.55 : 1.0;
    const peak = p.kind === "view"
      ? (0.14 + 0.28 * sharpness) * staleMul
      : p.kind === "model" ? 0.16 : 0.18;

    rDefs.append(svg("radialGradient", {
      id: gradId,
      gradientUnits: "userSpaceOnUse",
      cx: 0, cy: 0, r: 1,
      gradientTransform: `translate(${X(p.x).toFixed(1)}, ${Y(p.y).toFixed(1)}) scale(${rxPx.toFixed(1)}, ${ryPx.toFixed(1)})`,
    },
      svg("stop", { offset: "0%", "stop-color": c, "stop-opacity": peak.toFixed(3) }),
      svg("stop", { offset: "40%", "stop-color": c, "stop-opacity": (peak * 0.45).toFixed(3) }),
      svg("stop", { offset: "75%", "stop-color": c, "stop-opacity": (peak * 0.14).toFixed(3) }),
      svg("stop", { offset: "100%", "stop-color": c, "stop-opacity": "0" })));

    const shape = svg("path", {
      class: "region-shape",
      "data-key": p.key,
      "data-kind": p.kind,
      d: dPath,
      fill: `url(#${gradId})`,
      stroke: c,
      "stroke-linejoin": "round",
      "stroke-dasharray": p.kind === "view" ? "3 3" : p.kind === "model" ? "6 3" : null,
      "pointer-events": "fill",
    });
    shape.addEventListener("pointerenter", () => hoverOn(p, "ring"));
    shape.addEventListener("pointerleave", hoverOff);
    shape.addEventListener("click", (e) => { e.stopPropagation(); select(p.key); });
    rg.append(shape);

    // Optional contour label (shown when focused)
    let rimPt = null;
    for (const poly of reg.polygons) {
      for (const [ux, vy] of poly) {
        if (ux < x0 + 0.05 || ux > x1 - 0.05 || vy < y0 + 0.05 || vy > y1 - 0.05) continue;
        if (!rimPt || vy > rimPt[1] || (Math.abs(vy - rimPt[1]) < 1e-6 && ux < rimPt[0])) rimPt = [ux, vy];
      }
    }
    if (rimPt) {
      const rx = X(rimPt[0]), ry = Math.max(m.t + 12, Y(rimPt[1]) - 4);
      const rTxt = svg("text", {
        class: "rim-lbl",
        "data-key": p.key,
        "data-kind": p.kind,
        x: rx, y: ry,
        "text-anchor": rx < m.l + 50 ? "start" : rx > W - m.r - 50 ? "end" : "middle",
        "font-size": 10.5,
        "font-weight": 700,
        fill: c,
        stroke: surface,
        "stroke-width": 3,
        "paint-order": "stroke",
        "stroke-linejoin": "round",
        text: p.label,
      });
      rTxt.addEventListener("pointerenter", () => hoverOn(p, "ring"));
      rTxt.addEventListener("pointerleave", hoverOff);
      rTxt.addEventListener("click", (e) => { e.stopPropagation(); select(p.key); });
      rlg.append(rTxt);
    }
  }
  root.append(rDefs, rg, rlg);

  // History trail rendered ABOVE clouds so trail nodes stay hoverable & clickable at all times
  if (state.trail) {
    const [modelTrail, consTrail] = trailSeries();
    const tg = svg("g", { "clip-path": "url(#plot-clip)" });
    const act = activeSnapshotView();
    const drawTrail = (arr, dash, labelPrefix, w) => {
      if (arr.length < 2) return;
      tg.append(svg("polyline", {
        points: arr.map((h) => `${X(h.x)},${Y(h.y)}`).join(" "),
        fill: "none", stroke: ink2, "stroke-width": w, "stroke-dasharray": dash, "stroke-linejoin": "round",
        opacity: 0.55, "pointer-events": "none",
      }));
      arr.forEach((h, i) => {
        const isCurrentReplay = act.isReplay && h.as_of === act.asOf;
        const g = svg("g", { class: "trail-pt", transform: `translate(${X(h.x)},${Y(h.y)})` });
        g.append(svg("circle", { r: 8, fill: "transparent" }));
        g.append(svg("circle", {
          class: "trail-node",
          r: isCurrentReplay ? 5 : 3.2,
          fill: isCurrentReplay ? css("--focus") : ink2,
          stroke: isCurrentReplay ? surface : "none",
          "stroke-width": isCurrentReplay ? 1.5 : 0,
          opacity: isCurrentReplay ? 1 : (0.35 + 0.55 * (i / arr.length)),
        }));
        g.addEventListener("pointerenter", () => {
          const lv = impliedLevels(h.x, h.y);
          setHoverBar([
            el("span", { class: "hb-main", text: `${labelPrefix} historical path · ${h.as_of}: GDP ${lv.gdp.toFixed(2)}% (${fmt(h.x)}) · Core PCE ${lv.pce.toFixed(2)}% (${fmt(h.y)})` }),
            el("span", { class: "hb-meta", text: "Click this historical dot to replay the chart at this date." }),
          ]);
        });
        g.addEventListener("pointerleave", () => setHoverBar(defaultHoverBarNodes()));
        g.addEventListener("click", (e) => { e.stopPropagation(); jumpToHistoryDate(h.as_of); });
        tg.append(g);
      });
    };
    drawTrail(modelTrail, "3 3", "Hard data", 1.35);
    drawTrail(consTrail, null, "Houses consensus", 1.5);
    root.append(tg);
  }

  // Direction arrows (houses forward expectation) vs recent 3m tail (hard data)
  if (state.arrows) {
    const defs = svg("defs");
    const ag = svg("g", { "clip-path": "url(#plot-clip)" });
    for (const p of pts) {
      if (!p.dx && !p.dy) continue;
      const c = colorOf(p);
      const len = 0.42;
      if (p.kind === "model") {
        // Show lookback tail behind hard data rather than a forward arrow
        ag.append(svg("line", {
          "data-key": p.key,
          x1: X(p.x - p.dx * len), y1: Y(p.y - p.dy * len), x2: X(p.x), y2: Y(p.y),
          stroke: c, "stroke-width": 1.6, "stroke-dasharray": "2 2", opacity: 0.7,
        }));
      } else {
        const id = `ah-${p.key}`;
        defs.append(svg("marker", { id, viewBox: "0 0 8 8", refX: 6, refY: 4, markerWidth: 6.5, markerHeight: 6.5, orient: "auto-start-reverse" },
          svg("path", { d: "M0,0.6L7,4L0,7.4z", fill: c })));
        ag.append(svg("line", {
          "data-key": p.key,
          x1: X(p.x), y1: Y(p.y), x2: X(p.x + p.dx * len), y2: Y(p.y + p.dy * len),
          stroke: c, "stroke-width": 1.4, "marker-end": `url(#${id})`, opacity: p.stale ? 0.35 : 0.85,
        }));
      }
    }
    root.append(defs, ag);
  }

  // Markers
  const mg = svg("g");
  const placed = [];
  for (const p of pts) {
    const c = colorOf(p);
    const px = X(p.x), py = Y(p.y);
    const g = svg("g", {
      class: "pt", "data-key": p.key, transform: `translate(${px},${py})`,
      tabindex: 0, role: "button",
      "aria-label": `${p.name}: growth ${fmt(p.x)} pp, inflation ${fmt(p.y)} pp`,
    });
    g.append(svg("circle", { class: "hit", r: narrow ? 12 : 9, fill: "transparent" }));
    if (p.kind === "consensus") {
      g.append(svg("circle", { r: 9.5, fill: surface, "fill-opacity": 0.75, stroke: c, "stroke-width": 2.5 }));
      g.append(svg("circle", { r: 2.8, fill: c }));
    } else {
      const r = p.kind === "model" ? 6.2 : 5.5;
      g.append(svg("path", {
        d: markerPath(p.type, r),
        fill: p.stale ? surface : c,
        stroke: p.stale ? c : surface,
        "stroke-width": 2, "paint-order": "stroke",
      }));
    }
    g.addEventListener("pointerenter", () => hoverOn(p));
    g.addEventListener("pointerleave", hoverOff);
    g.addEventListener("focus", () => hoverOn(p));
    g.addEventListener("blur", hoverOff);
    g.addEventListener("click", (e) => { e.stopPropagation(); select(p.key); });
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(p.key); } });
    mg.append(g);
    const pad = p.kind === "consensus" ? 12 : 9;
    placed.push({ x: px - pad, y: py - pad, w: pad * 2, h: pad * 2 });
  }
  root.append(mg);

  // Direct clickable labels with 2-ring spiral collision avoidance + leader lines
  const lg = svg("g");
  root.append(lg);
  host.replaceChildren(root);

  const cands = [
    [10, 4, "start"], [-10, 4, "end"], [0, -12, "middle"], [0, 20, "middle"],
    [11, -10, "start"], [-11, -10, "end"], [11, 16, "start"], [-11, 16, "end"],
    [22, 4, "start"], [-22, 4, "end"], [18, -18, "start"], [-18, -18, "end"],
    [18, 24, "start"], [-18, 24, "end"], [0, -26, "middle"], [0, 32, "middle"],
    [34, -12, "start"], [-34, -12, "end"], [34, 18, "start"], [-34, 18, "end"],
  ];
  const order = [...pts].sort((a, b) => (a.kind === "view") - (b.kind === "view"));
  const fredLatest = modelDateStats().latest;
  const houseLatest = pts.filter((p) => p.kind === "view").map((p) => p.src.published).filter(Boolean).sort().at(-1) || "";
  for (const p of order) {
    const px = X(p.x), py = Y(p.y);
    const ptDate = p.kind === "view" ? p.src.published : p.kind === "model" ? fredLatest : houseLatest;
    const sd = !narrow && ptDate ? ` · ${shortDate(ptDate)}` : "";
    const t = svg("text", {
      class: "lbl",
      "data-key": p.key,
      "font-size": p.kind === "view" ? (narrow ? 10.5 : 11) : 11.5,
      "font-weight": p.kind === "view" ? 560 : 700,
      fill: p.kind === "view" ? ink2 : css("--ink"),
      stroke: surface, "stroke-width": 3.2, "paint-order": "stroke", "stroke-linejoin": "round",
      text: `${p.label}${sd}`,
    });
    lg.append(t);
    const bw = t.getComputedTextLength() + 3, bh = 13;
    let best = null;
    for (const [ox, oy, anchor] of cands) {
      const lx = anchor === "start" ? px + ox : anchor === "end" ? px + ox - bw : px - bw / 2;
      const box = { x: lx, y: py + oy - bh + 3, w: bw, h: bh };
      if (box.x < m.l || box.x + box.w > W - m.r || box.y < m.t || box.y + box.h > H - m.b) continue;
      const hits = placed.filter((q) => !(box.x + box.w + 2 < q.x || q.x + q.w + 2 < box.x || box.y + box.h + 2 < q.y || q.y + q.h + 2 < box.y)).length;
      if (!best || hits < best.hits) best = { hits, ox, oy, anchor, box };
      if (hits === 0) break;
    }
    if (!best) best = { ox: 10, oy: 4, anchor: "start", box: { x: px + 10, y: py - 9, w: bw, h: bh } };
    if (Math.hypot(best.ox, best.oy) > 19) {
      lg.insertBefore(svg("line", {
        "data-key": p.key, "pointer-events": "none",
        x1: px, y1: py, x2: px + best.ox * 0.78, y2: py + best.oy * 0.72,
        stroke: muted, "stroke-width": 0.9, opacity: 0.65,
      }), t);
    }
    t.setAttribute("x", px + best.ox);
    t.setAttribute("y", py + best.oy);
    t.setAttribute("text-anchor", best.anchor);
    t.addEventListener("pointerenter", () => hoverOn(p));
    t.addEventListener("pointerleave", hoverOff);
    t.addEventListener("click", (e) => { e.stopPropagation(); select(p.key); });
    placed.push(best.box);
  }

  root.addEventListener("click", () => resetToDefaultView());
  applyFocus();
}

function applyFocus() {
  const focus = state.hover || state.selected;
  const ptsByKey = new Map(points().map((p) => [p.key, p]));

  for (const path of document.querySelectorAll(".chart .region-shape")) {
    const key = path.dataset.key, kind = path.dataset.kind;
    const pt = ptsByKey.get(key);
    const activeMatch = pt ? pointMatchesFilter(pt) : true;
    const strong = key === focus;
    const dimHover = Boolean(state.hover) && !strong;
    const show = activeMatch && (state.allEllipses || kind !== "view" || strong);
    path.style.display = show ? "" : "none";
    if (kind === "view") {
      // Soft gradient cloud: no hard outer border unless explicitly focused/hovered
      path.setAttribute("fill-opacity", dimHover ? 0.12 : (strong ? 1.0 : 0.78));
      path.setAttribute("stroke-opacity", strong ? 0.55 : 0);
      path.setAttribute("stroke-width", strong ? 1.25 : 0);
    } else {
      path.setAttribute("fill-opacity", dimHover ? 0.15 : (strong ? 1.0 : 0.72));
      path.setAttribute("stroke-opacity", dimHover ? 0.14 : (strong ? 0.94 : 0.58));
      path.setAttribute("stroke-width", strong ? 2.2 : 1.35);
    }
  }

  for (const rlbl of document.querySelectorAll(".chart .rim-lbl")) {
    const key = rlbl.dataset.key, kind = rlbl.dataset.kind;
    const pt = ptsByKey.get(key);
    const activeMatch = pt ? pointMatchesFilter(pt) : true;
    const strong = key === focus;
    const dimHover = Boolean(state.hover) && !strong;
    const show = activeMatch && (strong || (kind !== "view" && state.allEllipses));
    rlbl.style.display = show ? "" : "none";
    rlbl.style.opacity = dimHover ? "0.2" : "1";
  }

  for (const n of document.querySelectorAll(".chart .pt, .chart .lbl, .chart line[data-key]")) {
    const key = n.dataset.key;
    const pt = ptsByKey.get(key);
    const matches = pt ? pointMatchesFilter(pt) : true;
    const dimHover = Boolean(state.hover) && key !== state.hover;
    n.classList.toggle("dim", !matches || dimHover);
  }
}

function hoverOn(p, source = "point") {
  state.hover = p.key;
  const lv = impliedLevels(p.x, p.y);
  const pq = [...allowedQuadrants(p)].map((q) => QUAD_NAMES[q]).join(" / ");
  const spread = `±${p.sx.toFixed(2)} / ±${p.sy.toFixed(2)}pp (1σ)`;
  const prefix = source === "ring" ? `${Math.round(Number(state.ci) * 100)}% cloud of ` : "";
  const fredDates = modelDateStats();
  const houseDates = state.snap.views.map((v) => v.published).filter(Boolean).sort();
  const extra = p.kind === "view"
    ? `Published ${p.src.published || "n.d."}${p.src.age_days != null ? ` (${p.src.age_days}d ago)` : ""}${p.stale ? " · stale" : ""} · ${spread} · ${pq}`
    : p.kind === "model"
      ? `Latest FRED obs: ${fredDates.latest} (window ${fredDates.earliest} – ${fredDates.latest}) · ${state.snap.model.indicators.length} indicators`
      : `House notes: ${houseDates[0] || "n.d."} – ${houseDates.at(-1) || "n.d."} · ${state.snap.views.length} views`;
  setHoverBar([
    el("span", { class: "hb-main" },
      el("span", { class: "key", style: `background:${colorOf(p)}` }),
      `${prefix}${p.name}: GDP ${lv.gdp.toFixed(2)}% (${fmt(p.x)}) · Core PCE ${lv.pce.toFixed(2)}% (${fmt(p.y)})`),
    el("span", { class: "hb-meta", text: extra }),
  ]);
  applyFocus();
}

function hoverOff() {
  state.hover = null;
  setHoverBar(defaultHoverBarNodes());
  applyFocus();
}

// ------------------------------------------------------------------ detail, compare, drawer

function defaultKey() {
  const act = activeSnapshotView();
  return act.backfillOnly || state.basis === "model" ? "data_model" : "houses";
}

function resetToDefaultView() {
  state.selected = defaultKey();
  state.hover = null;
  state.detailMode = "inspect";
  closeDrawer();
  setHoverBar(defaultHoverBarNodes());
  renderDetail();
  applyFocus();
  for (const tr of document.querySelectorAll("#views-table tbody tr")) {
    tr.classList.remove("sel");
  }
}

function select(key, opts = {}) {
  const def = defaultKey();
  if (state.selected === key && key !== def && state.detailMode === "inspect") {
    return resetToDefaultView();
  }
  state.selected = key;
  if (state.detailMode === "compare") state.detailMode = "inspect";
  renderDetail();
  applyFocus();
  for (const tr of document.querySelectorAll("#views-table tbody tr")) {
    tr.classList.toggle("sel", tr.dataset.id === key);
  }
  if (opts.fromTable) {
    const panel = document.getElementById("detail");
    const rect = panel.getBoundingClientRect();
    const visibleH = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
    if (visibleH < 180) openDrawer(key);
  }
}

function coordsBlock(x, sx, y, sy) {
  const lv = impliedLevels(x, y);
  return el("div", { class: "coords" },
    el("div", {},
      el("div", { class: "l", text: "Growth" }),
      el("div", { class: "v", text: `${lv.gdp.toFixed(2)}%` }),
      el("div", { class: "s", text: `${fmt(x)}pp vs trend (±${sx.toFixed(2)})` })),
    el("div", {},
      el("div", { class: "l", text: "Core PCE" }),
      el("div", { class: "v", text: `${lv.pce.toFixed(2)}%` }),
      el("div", { class: "s", text: `${fmt(y)}pp vs target (±${sy.toFixed(2)})` })));
}

function regionScopeLine(point, reasonText) {
  const allowed = [...allowedQuadrants(point)];
  const labels = allowed.map((q) => QUAD_NAMES[q]).join(" + ");
  return el("div", { class: "scope-box" },
    el("b", { text: "Region scope: " }),
    `${labels}. `,
    el("span", { class: "muted", text: reasonText }));
}

function entityCatalog() {
  const act = activeSnapshotView();
  const out = [];
  if (!act.backfillOnly && act.blend.houses) {
    out.push({ key: "houses", label: "Houses consensus", pt: { ...act.blend.houses, name: "Houses consensus", kind: "consensus" } });
  }
  out.push({ key: "data_model", label: "Hard-data model (FRED)", pt: { ...act.modelPt, name: "Hard-data model (FRED)", kind: "model" } });
  for (const v of act.views) out.push({ key: v.id, label: v.name, pt: { ...v, kind: "view" } });
  return out;
}

function buildInspectNodes(key) {
  const s = state.snap;
  const act = activeSnapshotView();
  const parts = [];

  if (key === "houses" || key === "consensus") {
    const b = act.blend.houses;
    if (!b) return buildInspectNodes("data_model");
    const q = quadrantOf(b.x, b.y);
    const houseDates = act.views.map((v) => v.published).filter(Boolean).sort();
    parts.push(
      el("h3", { text: "Houses consensus" }),
      el("div", { class: "meta" },
        el("span", { class: "chip q-chip", style: `--q-color:var(${QUAD_COLOR_VAR[q]})`, text: QUAD_NAMES[q] }),
        el("span", { class: "chip", text: `${act.views.length} house views` }),
        houseDates.length ? el("span", { class: "chip", text: `Notes ${houseDates[0]} – ${houseDates.at(-1)}` }) : null),
      coordsBlock(b.x, b.sx, b.y, b.sy),
      el("div", { class: "scope-box" },
        el("b", { text: "Weighted consensus: " }),
        "Weighted mean of all house coordinates (confidence × freshness), shown as a benchmark point without an outer ring."),
      el("p", { text: act.isReplay ? `Historical snapshot on ${act.asOf}.` : (s.synthesis?.consensus_vs_data || "") }),
      el("h4", { text: "Houses vs hard data" }),
      el("table", { class: "nums" }, el("tbody", {},
        el("tr", {}, el("td", { text: "Houses consensus" }), el("td", { text: `${fmt(b.x)} / ${fmt(b.y)}` }), el("td", { text: QUAD_NAMES[quadrantOf(b.x, b.y)] })),
        el("tr", {}, el("td", { text: "Hard-data model" }), el("td", { text: `${fmt(act.modelPt.x)} / ${fmt(act.modelPt.y)}` }), el("td", { text: QUAD_NAMES[quadrantOf(act.modelPt.x, act.modelPt.y)] })))),
      el("div", { class: "quick-compare" },
        el("button", {
          type: "button", class: "ghost small-btn",
          onclick: () => { state.compareA = "houses"; state.compareB = "data_model"; state.detailMode = "compare"; renderDetail(); },
          text: "Compare Houses vs Hard data",
        })));
  } else if (key === "data_model") {
    const p = act.modelPt;
    const q = quadrantOf(p.x, p.y);
    const fredDates = modelDateStats();
    const top = [...s.model.indicators].sort((a, b) => Math.abs(b.gap * b.weight) - Math.abs(a.gap * a.weight)).slice(0, 6);
    parts.push(
      el("h3", { text: "Hard-data model (FRED)" }),
      el("div", { class: "meta" },
        el("span", { class: "chip q-chip", style: `--q-color:var(${QUAD_COLOR_VAR[q]})`, text: QUAD_NAMES[q] }),
        el("span", { class: "chip", text: `${s.model.indicators.length} indicators` }),
        el("span", { class: "chip", text: `Obs ${fredDates.earliest} – ${fredDates.latest}` })),
      coordsBlock(p.x, p.sx, p.y, p.sy),
      el("div", { class: "scope-box" },
        el("b", { text: "Benchmark point: " }),
        "Plotted as an observed data coordinate without an uncertainty circle."),
      !act.isReplay ? el("p", { class: "small", text: `3-month momentum: growth ${fmt(p.dx)}pp, inflation ${fmt(p.dy)}pp.` }) : null,
      el("h4", { text: "Biggest weighted drivers" }),
      el("table", { class: "nums" }, el("tbody", {}, top.map((r) =>
        el("tr", {}, el("td", { text: r.label.split(" (")[0] }), el("td", { text: `${fmt(r.gap)}pp` }), el("td", { text: `${r.weight}×` }))))),
      el("p", { class: "rationale", text: s.model.caveat || "" }),
      el("div", { class: "quick-compare" },
        el("button", {
          type: "button", class: "ghost small-btn",
          onclick: () => { state.compareA = "houses"; state.compareB = "data_model"; state.detailMode = "compare"; renderDetail(); },
          text: "Compare vs Houses",
        })));
  } else {
    const v = act.views.find((x) => x.id === key);
    if (!v) return buildInspectNodes(act.backfillOnly ? "data_model" : "houses");
    const q = quadrantOf(v.x, v.y);
    const url = safeUrl(v.url);
    const allowed = [...allowedQuadrants(v)];
    const scopeMsg = allowed.length > 1
      ? `Commentary cites risk/scenario crossing into ${allowed.filter((x) => x !== q).map((x) => QUAD_NAMES[x]).join(", ")}.`
      : "No scenario or risk outside base quadrant cited in commentary.";
    const vColor = colorOf({ kind: "view", key: v.id });
    parts.push(
      el("h3", {}, el("span", { class: "swatch-dot", style: `background:${vColor}` }), v.name),
      el("div", { class: "meta" },
        el("span", { class: "chip" }, el("span", { class: "key", style: `background:${vColor}` }), TYPE_LABEL[v.type] || v.type),
        el("span", { class: "chip q-chip", style: `--q-color:var(${QUAD_COLOR_VAR[q]})`, text: QUAD_NAMES[q] }),
        el("span", { class: `chip${v.stale ? " stale" : ""}`, text: `${v.published || "n.d."}${v.age_days != null ? ` · ${v.age_days}d ago` : ""}${v.stale ? " · stale" : ""}` }),
        el("span", { class: "chip", text: `Confidence: ${v.confidence}` })),
      url ? el("p", {}, el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: v.title || url })) : el("p", { text: v.title || "" }),
      coordsBlock(v.x, v.sx, v.y, v.sy),
      regionScopeLine(v, scopeMsg),
      el("p", { text: v.summary }),
      v.forecast_numbers?.length ? [
        el("h4", { text: "Forecast numbers" }),
        el("table", { class: "nums" }, el("tbody", {}, v.forecast_numbers.map((f) => el("tr", {}, el("td", { text: f.metric }), el("td", { text: f.value }), el("td", { text: f.period }))))),
      ] : null,
      v.key_points?.length ? [
        el("h4", { text: "Key points" }),
        el("ul", { class: "bullets" }, v.key_points.map((k) => el("li", { text: k }))),
      ] : null,
      v.quotes?.length ? [
        el("h4", { text: "In their words" }),
        el("div", { class: "quotes" }, v.quotes.map((qt) => el("blockquote", { text: `“${qt}”` }))),
      ] : null,
      el("h4", { text: "How it was scored" }),
      el("p", { class: "rationale", text: `${v.scoring_rationale || ""} (${v.method || "?"})` }),
      el("div", { class: "quick-compare" },
        el("button", {
          type: "button", class: "ghost small-btn",
          onclick: () => { state.compareA = v.id; state.compareB = "data_model"; state.detailMode = "compare"; renderDetail(); },
          text: "Compare vs Hard data",
        }),
        el("button", {
          type: "button", class: "ghost small-btn",
          onclick: () => { state.compareA = v.id; state.compareB = "houses"; state.detailMode = "compare"; renderDetail(); },
          text: "Compare vs Consensus",
        })));
  }
  return parts.flat(2).filter(Boolean);
}

function buildCompareNodes() {
  const cat = entityCatalog();
  const findItem = (k) => cat.find((x) => x.key === k) || cat[0];
  const a = findItem(state.compareA);
  const b = findItem(state.compareB);
  state.compareA = a.key;
  state.compareB = b.key;

  const sel = (cur, onChange) => el("select", { onchange: (e) => onChange(e.target.value) },
    cat.map((item) => el("option", { value: item.key, selected: item.key === cur, text: item.label })));

  const dx = a.pt.x - b.pt.x, dy = a.pt.y - b.pt.y;
  const col = (item) => {
    const lv = impliedLevels(item.pt.x, item.pt.y);
    const allowed = [...allowedQuadrants(item.pt)].map((q) => QUAD_NAMES[q]).join(", ");
    const pts = item.pt.key_points || (item.pt.summary ? [item.pt.summary] : []);
    return el("div", { class: "compare-col" },
      el("h5", { text: item.label }),
      el("div", { class: "small", text: `GDP: ${lv.gdp.toFixed(2)}% (${fmt(item.pt.x)})` }),
      el("div", { class: "small", text: `Core PCE: ${lv.pce.toFixed(2)}% (${fmt(item.pt.y)})` }),
      el("div", { class: "small muted", style: "margin-top:4px", text: `Scope: ${allowed}` }),
      pts.length ? el("ul", { class: "bullets", style: "margin-top:6px" }, pts.slice(0, 3).map((t) => el("li", { text: t }))) : null);
  };

  return [
    el("div", { class: "compare-pickers" },
      sel(state.compareA, (v) => { state.compareA = v; renderDetail(); }),
      sel(state.compareB, (v) => { state.compareB = v; renderDetail(); })),
    el("div", { class: "compare-delta" },
      el("b", { text: "Spread (A − B): " }),
      `Growth ${fmt(dx)}pp · Inflation ${fmt(dy)}pp`),
    el("div", { class: "compare-grid" }, col(a), col(b)),
  ];
}

function renderDetail() {
  const box = document.getElementById("detail");
  const tabs = el("div", { class: "detail-tabs" },
    el("div", { class: "seg", role: "tablist" },
      el("button", { type: "button", role: "tab", "aria-checked": String(state.detailMode === "inspect"), onclick: () => { state.detailMode = "inspect"; renderDetail(); }, text: "Inspect" }),
      el("button", { type: "button", role: "tab", "aria-checked": String(state.detailMode === "compare"), onclick: () => { state.detailMode = "compare"; renderDetail(); }, text: "Compare" })),
    el("span", { class: "muted small", text: state.detailMode === "inspect" ? "Point details" : "Side-by-side" }));

  const body = state.detailMode === "compare" ? buildCompareNodes() : buildInspectNodes(state.selected);
  box.replaceChildren(tabs, ...body);
}

function openDrawer(key) {
  const drawer = document.getElementById("drawer");
  const backdrop = document.getElementById("drawer-backdrop");
  document.getElementById("drawer-body").replaceChildren(...buildInspectNodes(key));
  drawer.hidden = false;
  backdrop.hidden = false;
}

function closeDrawer() {
  document.getElementById("drawer").hidden = true;
  document.getElementById("drawer-backdrop").hidden = true;
}

// ------------------------------------------------------------------ timeline & replay

function renderTimeline() {
  const entries = timelineEntries();
  const card = document.getElementById("timeline-card");
  const replayBar = document.getElementById("replay-bar");
  if (entries.length < 2) {
    card.hidden = true;
    replayBar.hidden = true;
    return;
  }
  card.hidden = false;
  replayBar.hidden = false;

  const slider = document.getElementById("replay-slider");
  slider.max = String(entries.length - 1);
  const curIdx = state.replayIdx === null ? entries.length - 1 : state.replayIdx;
  slider.value = String(curIdx);
  document.getElementById("replay-label").textContent = state.replayIdx === null ? `${entries[curIdx].as_of} (Live)` : entries[curIdx].as_of;
  document.getElementById("replay-reset").hidden = state.replayIdx === null;

  const host = document.getElementById("timeline-chart");
  const W = Math.max(320, host.clientWidth || 1100);
  const H = 190;
  const m = { t: 16, r: 24, b: 30, l: 44 };

  const allVals = entries.flatMap((e) => [e.model?.x ?? 0, e.model?.y ?? 0, e.houses?.x ?? 0, e.houses?.y ?? 0]);
  const [y0, y1] = niceDomain(allVals, 1.5, 0.5);
  const X = (i) => m.l + (i / Math.max(1, entries.length - 1)) * (W - m.l - m.r);
  const Y = (v) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);

  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Growth and inflation gap over time" });
  const gridC = css("--grid"), axisC = css("--axis"), muted = css("--muted"), ink2 = css("--ink-2");
  const gColor = css("--sell"), iColor = css("--buy");

  for (let v = Math.ceil(y0 * 2) / 2; v <= y1 + 1e-9; v += 0.5) {
    const isZero = Math.abs(v) < 1e-9;
    root.append(svg("line", {
      x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v),
      stroke: isZero ? axisC : gridC, "stroke-width": isZero ? 1.4 : 0.7, "stroke-dasharray": isZero ? "4 3" : null,
    }));
    if (Math.abs(v % 1) < 1e-9 || isZero) {
      root.append(svg("text", { x: m.l - 6, y: Y(v) + 4, "text-anchor": "end", "font-size": 10.5, fill: muted, text: isZero ? "0" : fmt(v, 0) }));
    }
  }

  // Model growth and inflation lines
  const mGrowth = entries.map((e, i) => e.model ? [i, e.model.x, e.as_of] : null).filter(Boolean);
  const mInfl = entries.map((e, i) => e.model ? [i, e.model.y, e.as_of] : null).filter(Boolean);
  if (mGrowth.length >= 2) {
    root.append(svg("polyline", { points: mGrowth.map(([i, v]) => `${X(i)},${Y(v)}`).join(" "), fill: "none", stroke: gColor, "stroke-width": 2 }));
  }
  if (mInfl.length >= 2) {
    root.append(svg("polyline", { points: mInfl.map(([i, v]) => `${X(i)},${Y(v)}`).join(" "), fill: "none", stroke: iColor, "stroke-width": 2 }));
  }

  // Highlight active replay marker
  root.append(svg("line", { x1: X(curIdx), x2: X(curIdx), y1: m.t, y2: H - m.b, stroke: ink2, "stroke-width": 1.2, "stroke-dasharray": "2 2" }));

  // Clickable nodes + sparse x ticks
  const step = Math.max(1, Math.floor(entries.length / 6));
  entries.forEach((e, i) => {
    if (i % step === 0 || i === entries.length - 1) {
      root.append(svg("text", { x: X(i), y: H - 8, "text-anchor": i === 0 ? "start" : i === entries.length - 1 ? "end" : "middle", "font-size": 10.5, fill: muted, text: e.as_of.slice(0, 7) }));
    }
    const hit = svg("rect", { x: X(i) - 6, y: m.t, width: 12, height: H - m.t - m.b, fill: "transparent", style: "cursor:pointer" });
    hit.addEventListener("click", () => setReplayIndex(i === entries.length - 1 ? null : i));
    root.append(hit);
    if (e.model) {
      root.append(svg("circle", { cx: X(i), cy: Y(e.model.x), r: i === curIdx ? 4.5 : 2.5, fill: gColor, "pointer-events": "none" }));
      root.append(svg("circle", { cx: X(i), cy: Y(e.model.y), r: i === curIdx ? 4.5 : 2.5, fill: iColor, "pointer-events": "none" }));
    }
  });

  // Compact inline legend
  root.append(
    svg("text", { x: m.l + 6, y: m.t + 11, "font-size": 11, "font-weight": 650, fill: gColor, text: "● Hard-data growth gap" }),
    svg("text", { x: m.l + 150, y: m.t + 11, "font-size": 11, "font-weight": 650, fill: iColor, text: "● Hard-data inflation gap" }),
  );
  host.replaceChildren(root);
}

function setReplayIndex(idx) {
  state.replayIdx = idx;
  renderHero();
  renderChart();
  renderDetail();
  renderTimeline();
}

function jumpToHistoryDate(asOf) {
  const entries = timelineEntries();
  const idx = entries.findIndex((e) => e.as_of === asOf);
  if (idx >= 0) setReplayIndex(idx === entries.length - 1 ? null : idx);
}

// ------------------------------------------------------------------ supports & tables

const SUPPORT_LABEL = { above_trend: "Above trend", below_trend: "Below trend", above_target: "Above target", below_target: "Below target", neutral: "Neutral" };

function renderSupports() {
  const s = state.snap, syn = s.synthesis || {};
  document.getElementById("data-supports").textContent = syn.data_supports || "";
  document.getElementById("consensus-vs-data").textContent = syn.consensus_vs_data || "";
  document.getElementById("synth-method").textContent = syn.method ? `summary by: ${syn.method}` : "";

  const divs = syn.divergences || [];
  document.getElementById("divergences-wrap").hidden = divs.length === 0;
  document.getElementById("divergences").replaceChildren(...divs.map((d) => el("li", { text: d })));

  const watch = syn.watch_list || [];
  document.getElementById("watch-wrap").hidden = watch.length === 0;
  document.getElementById("watch").replaceChildren(...watch.map((d) => el("li", { text: d })));

  renderIndicatorsTable();
}

function renderIndicatorsTable() {
  const s = state.snap;
  const tbody = document.querySelector("#indicators tbody");
  const rows = [];
  const axes = state.indFilter === "growth" ? ["growth"] : state.indFilter === "inflation" ? ["inflation"] : ["growth", "inflation"];

  for (const axis of axes) {
    const agg = s.model.point;
    const mean = axis === "growth" ? agg.x : agg.y;
    const inds = s.model.indicators.filter((i) => {
      if (i.axis !== axis) return false;
      if (state.indFilter === "cool") return i.gap <= 0.25;
      return true;
    });
    if (!inds.length) continue;
    rows.push(el("tr", { class: "axis-row" }, el("td", { colspan: 6, text: `${axis === "growth" ? "Growth" : "Inflation"} — model ${fmt(mean)} pp` })));
    for (const r of inds) {
      const lim = 3, g = Math.max(-lim, Math.min(lim, r.gap));
      const left = g >= 0 ? 50 : 50 + (g / lim) * 50, width = Math.abs(g / lim) * 50;
      const expanded = state.expandedInds.has(r.id);
      rows.push(el("tr", {
        class: "ind-row",
        onclick: () => {
          if (state.expandedInds.has(r.id)) state.expandedInds.delete(r.id);
          else state.expandedInds.add(r.id);
          renderIndicatorsTable();
        },
      },
        el("td", {}, el("span", { text: r.label }), el("span", { class: "muted small", text: expanded ? " ▾" : " ▸" })),
        el("td", { class: "num", text: `${r.value.toFixed(2)}${r.unit === "%" ? "%" : r.unit === "k" ? "k" : ""}` }),
        el("td", { class: "muted", text: r.observation_date || "" }),
        el("td", { class: "num" }, el("span", { class: "wt-badge", text: `${r.weight}×` })),
        el("td", {}, el("div", { class: "gapbar" },
          el("div", { class: "track", "aria-hidden": "true" }, el("span", { class: `fill${Math.abs(r.gap) < 0.25 ? " weak" : ""}`, style: `left:${left}%;width:${Math.max(width, 0.8)}%` })),
          el("span", { class: "gv", text: fmt(r.gap) }))),
        el("td", { class: "sup", text: SUPPORT_LABEL[r.supports] || r.supports })));
      if (expanded) {
        rows.push(el("tr", { class: "ind-note-row" },
          el("td", { colspan: 6, text: `Rule of thumb: ${r.note} · FRED series: ${(r.series || []).join(", ")}` })));
      }
    }
  }
  tbody.replaceChildren(...rows);
}

function renderViewsTable() {
  const act = activeSnapshotView();
  const q = state.viewsSearch.trim().toLowerCase();
  const filtered = act.views.filter((v) => {
    if (state.viewsFilter === "fresh" && v.stale) return false;
    if (state.viewsFilter === "sell_side" && v.type !== "sell_side") return false;
    if (state.viewsFilter === "buy_side" && v.type !== "buy_side") return false;
    if (state.viewsFilter === "tail" && (v.plausible_quadrants || []).length <= 1 && v.quadrant === "overheating") return false;
    if (q) {
      const hay = `${v.name} ${v.short || ""} ${v.summary || ""} ${(v.key_points || []).join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const { key, dir } = state.viewsSort;
  const valOf = (v) => {
    if (key === "name") return v.name;
    if (key === "type") return TYPE_LABEL[v.type] || v.type;
    if (key === "published") return v.published || "";
    if (key === "x" || key === "y") return v[key];
    if (key === "quadrant") return quadrantOf(v.x, v.y);
    if (key === "confidence") return CONF_RANK[v.confidence] || 0;
    return v.y;
  };
  filtered.sort((a, b) => {
    const va = valOf(a), vb = valOf(b);
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });

  for (const th of document.querySelectorAll("#views-table th.sortable")) {
    th.classList.toggle("sorted", th.dataset.sort === key);
  }

  const rows = filtered.map((v) => {
    const color = colorOf({ kind: "view", key: v.id });
    const icon = svg("svg", { class: "shape", width: 12, height: 12, viewBox: "-6 -6 12 12", "aria-hidden": "true" },
      svg("path", { d: markerPath(v.type, 4.5), fill: v.stale ? "none" : color, stroke: color, "stroke-width": 1.6 }));
    const allowed = [...allowedQuadrants(v)].map((qd) => QUAD_NAMES[qd]).join(" / ");
    return el("tr", {
      "data-id": v.id,
      class: state.selected === v.id ? "sel" : "",
      tabindex: 0,
      onclick: () => select(v.id, { fromTable: true }),
      onkeydown: (e) => { if (e.key === "Enter") select(v.id, { fromTable: true }); },
    },
      el("td", {}, icon, v.name),
      el("td", { text: TYPE_LABEL[v.type] || v.type }),
      el("td", { text: `${v.published || "n.d."}${v.age_days != null ? ` (${v.age_days}d)` : ""}${v.stale ? " · stale" : ""}` }),
      el("td", { class: "num", text: `${fmt(v.x)} ±${v.sx.toFixed(2)}` }),
      el("td", { class: "num", text: `${fmt(v.y)} ±${v.sy.toFixed(2)}` }),
      el("td", { text: allowed }),
      el("td", { class: "key-call-cell", text: keyCallText(v) }),
      el("td", { text: v.confidence }));
  });
  document.querySelector("#views-table tbody").replaceChildren(...rows);
}

// ------------------------------------------------------------------ controls

function syncClearFiltersBtn() {
  const btn = document.getElementById("clear-filters");
  btn.hidden = !(state.filterQuad || state.filterType);
}

function bindSeg(id, attr, onPick) {
  const box = document.getElementById(id);
  box.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    for (const x of box.querySelectorAll("button")) x.setAttribute("aria-checked", String(x === b));
    onPick(b.dataset[attr]);
  });
}

function bindControls() {
  bindSeg("prob-basis", "basis", (v) => {
    state.basis = v;
    if (v === "houses" && state.selected === "data_model") state.selected = "houses";
    else if (v === "model" && state.selected === "houses") state.selected = "data_model";
    renderHero();
    renderLegend();
    renderChart();
    renderDetail();
  });
  bindSeg("zoom-mode", "zoom", (v) => { state.zoom = v; renderChart(); });
  bindSeg("ci", "ci", (v) => { state.ci = v; renderChart(); });

  const chk = (id, key) => document.getElementById(id).addEventListener("change", (e) => { state[key] = e.target.checked; renderChart(); });
  document.getElementById("opt-ellipses").addEventListener("change", (e) => { state.allEllipses = e.target.checked; applyFocus(); });
  chk("opt-arrows", "arrows");
  chk("opt-trail", "trail");
  document.getElementById("opt-stale").addEventListener("change", (e) => {
    state.showStale = e.target.checked;
    renderHero();
    renderChart();
  });

  document.getElementById("clear-filters").addEventListener("click", () => {
    state.filterQuad = null;
    state.filterType = null;
    syncClearFiltersBtn();
    renderTilesOnly();
    renderLegend();
    applyFocus();
  });

  // Indicator filters
  document.getElementById("ind-filter").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-ind]");
    if (!b) return;
    state.indFilter = b.dataset.ind;
    for (const x of document.querySelectorAll("#ind-filter .pill")) x.classList.toggle("active", x === b);
    renderIndicatorsTable();
  });

  // Views filters, search, sort
  document.getElementById("views-filter").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-vf]");
    if (!b) return;
    state.viewsFilter = b.dataset.vf;
    for (const x of document.querySelectorAll("#views-filter .pill")) x.classList.toggle("active", x === b);
    renderViewsTable();
  });
  document.getElementById("views-search").addEventListener("input", (e) => {
    state.viewsSearch = e.target.value;
    renderViewsTable();
  });
  for (const th of document.querySelectorAll("#views-table th.sortable")) {
    th.addEventListener("click", () => {
      const k = th.dataset.sort;
      if (state.viewsSort.key === k) state.viewsSort.dir *= -1;
      else state.viewsSort = { key: k, dir: k === "x" || k === "y" || k === "confidence" || k === "published" ? -1 : 1 };
      renderViewsTable();
    });
  }

  // Replay controls
  document.getElementById("replay-slider").addEventListener("input", (e) => {
    const entries = timelineEntries();
    const idx = Number(e.target.value);
    setReplayIndex(idx >= entries.length - 1 ? null : idx);
  });
  document.getElementById("replay-prev").addEventListener("click", () => {
    const entries = timelineEntries();
    const cur = state.replayIdx === null ? entries.length - 1 : state.replayIdx;
    setReplayIndex(Math.max(0, cur - 1));
  });
  document.getElementById("replay-next").addEventListener("click", () => {
    const entries = timelineEntries();
    const cur = state.replayIdx === null ? entries.length - 1 : state.replayIdx;
    const nxt = Math.min(entries.length - 1, cur + 1);
    setReplayIndex(nxt >= entries.length - 1 ? null : nxt);
  });
  document.getElementById("replay-reset").addEventListener("click", () => {
    clearInterval(state.replayTimer);
    state.replayTimer = null;
    document.getElementById("replay-play").textContent = "Play";
    setReplayIndex(null);
  });
  document.getElementById("replay-play").addEventListener("click", () => {
    const btn = document.getElementById("replay-play");
    if (state.replayTimer) {
      clearInterval(state.replayTimer);
      state.replayTimer = null;
      btn.textContent = "Play";
      return;
    }
    const entries = timelineEntries();
    if (state.replayIdx === null || state.replayIdx >= entries.length - 1) state.replayIdx = 0;
    btn.textContent = "Pause";
    setReplayIndex(state.replayIdx);
    state.replayTimer = setInterval(() => {
      const nxt = (state.replayIdx ?? 0) + 1;
      if (nxt >= entries.length - 1) {
        clearInterval(state.replayTimer);
        state.replayTimer = null;
        btn.textContent = "Play";
        setReplayIndex(null);
      } else {
        setReplayIndex(nxt);
      }
    }, 650);
  });

  // Drawer
  document.getElementById("drawer-close").addEventListener("click", closeDrawer);
  document.getElementById("drawer-backdrop").addEventListener("click", closeDrawer);
  document.getElementById("drawer-to-chart").addEventListener("click", () => {
    closeDrawer();
    document.getElementById("chart").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

  let t = 0;
  let lastW = 0;
  const onResize = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const curW = document.getElementById("chart").clientWidth;
      if (curW && curW !== lastW) {
        lastW = curW;
        renderChart();
        renderTimeline();
      }
    }, 80);
  };
  window.addEventListener("resize", onResize);
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(onResize).observe(document.getElementById("chart"));
  }
}

function renderAll() {
  if (!state.snap) return;
  renderHero();
  renderLegend();
  renderChart();
  renderDetail();
  renderTimeline();
  renderSupports();
  renderViewsTable();
}

async function main() {
  bindControls();
  try {
    await load();
    renderAll();
  } catch (err) {
    const banner = document.getElementById("banner");
    banner.hidden = false;
    banner.replaceChildren(el("b", { text: "Could not load data. " }), `${err.message}. Check apiBase in config.js (currently "${apiBase() || "same origin"}").`);
    document.getElementById("asof").textContent = "No data";
  }
}

main();
