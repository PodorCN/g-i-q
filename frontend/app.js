// g-i-q frontend. Reads everything from the backend API; never needs redeploying for data updates.

const SVGNS = "http://www.w3.org/2000/svg";
const QUAD_NAMES = {
  goldilocks: "Goldilocks",
  overheating: "Overheating",
  stagflation: "Stagflation",
  slowdown: "Disinflationary slowdown",
};
const QUAD_SIGNS = {
  goldilocks: "g↑ π↓",
  overheating: "g↑ π↑",
  stagflation: "g↓ π↑",
  slowdown: "g↓ π↓",
};
const TYPE_LABEL = { sell_side: "Sell-side bank", buy_side: "Asset manager", official: "Official sector" };
const TYPE_VAR = { sell_side: "--sell", buy_side: "--buy", official: "--official" };
// k = sqrt(chi-square quantile, 2 dof): radius scale of a bivariate normal confidence region
const CI_K = { "0.68": Math.sqrt(-2 * Math.log(1 - 0.68)), "0.90": Math.sqrt(-2 * Math.log(1 - 0.9)) };

const state = {
  snap: null,
  history: [],
  basis: "blended",
  ci: "0.68",
  allEllipses: false,
  arrows: true,
  trail: true,
  showStale: true,
  selected: "consensus",
  hover: null,
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
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
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
const pct = (v) => `${Math.round(v * 100)}%`;
const safeUrl = (u) => {
  try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.href : null; } catch { return null; }
};
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};
function quadrantOf(x, y) { return x >= 0 ? (y >= 0 ? "overheating" : "goldilocks") : (y >= 0 ? "stagflation" : "slowdown"); }

// ------------------------------------------------------------------ data

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
  state.history = hist.points || [];
}

// Points drawn on the chart, in a stable order (houses, data model, consensus last = on top)
function points() {
  const s = state.snap;
  const views = s.views.filter((v) => state.showStale || !v.stale);
  const m = s.model.point;
  const b = s.blend.blended;
  return [
    ...views.map((v) => ({ kind: "view", key: v.id, label: v.short || v.name, name: v.name, type: v.type, x: v.x, y: v.y, sx: v.sx, sy: v.sy, dx: v.dx, dy: v.dy, stale: v.stale, src: v })),
    { kind: "model", key: "data_model", label: "Hard data", name: m.name, type: "model", x: m.x, y: m.y, sx: m.sx, sy: m.sy, dx: m.dx, dy: m.dy, src: m },
    { kind: "consensus", key: "consensus", label: "Blended", name: "Blended consensus", type: "consensus", x: b.x, y: b.y, sx: b.sx, sy: b.sy, src: b },
  ];
}

function colorOf(p) {
  if (p.type in TYPE_VAR) return css(TYPE_VAR[p.type]);
  return css("--ink");
}

// ------------------------------------------------------------------ hero

function renderHero() {
  const s = state.snap;
  document.getElementById("asof").textContent = `As of ${s.as_of} · ${s.views.length} house views + hard data`;
  document.getElementById("headline").textContent = s.synthesis?.headline || "";
  document.getElementById("footer-gen").textContent = `Generated ${s.generated_at?.replace("T", " ").replace("+00:00", " UTC") || ""}`;
  renderTiles();
  for (const span of document.querySelectorAll("[data-param]")) {
    const v = s.params?.[span.dataset.param];
    span.textContent = v === undefined ? "?" : span.hasAttribute("data-pct") ? pct(v) : String(v);
  }
}

function renderTiles() {
  const s = state.snap;
  const probs = (s.blend[state.basis] || s.blend.blended).probabilities;
  const top = Object.keys(probs).reduce((a, b) => (probs[a] >= probs[b] ? a : b));
  const order = ["goldilocks", "overheating", "slowdown", "stagflation"];
  const box = document.getElementById("tiles");
  box.replaceChildren(...order.map((q) => el("div", { class: `tile${q === top ? " top" : ""}` },
    el("div", { class: "q" }, el("span", { text: QUAD_NAMES[q] }), el("span", { class: "sig", text: QUAD_SIGNS[q] })),
    el("div", { class: "p", text: pct(probs[q] || 0) }),
    el("div", { class: "bar", "aria-hidden": "true" }, el("span", { style: `width:${(probs[q] || 0) * 100}%` })),
  )));
}

// ------------------------------------------------------------------ chart

function niceDomain(vals, minSpan) {
  let lo = Math.min(...vals, 0), hi = Math.max(...vals, 0);
  if (hi - lo < minSpan) { const c = (hi + lo) / 2; lo = c - minSpan / 2; hi = c + minSpan / 2; }
  lo = Math.floor(lo * 2) / 2; hi = Math.ceil(hi * 2) / 2;
  return [lo, hi];
}

function markerPath(type, r) {
  switch (type) {
    case "buy_side": return `M${-r},${-r}h${2 * r}v${2 * r}h${-2 * r}z`; // square
    case "official": { const h = r * 1.25; return `M0,${-h}L${h},${h * 0.8}L${-h},${h * 0.8}z`; } // triangle
    case "model": { const h = r * 1.35; return `M0,${-h}L${h},0L0,${h}L${-h},0z`; } // diamond
    default: return `M${-r},0a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`; // circle
  }
}

function renderLegend() {
  const items = [
    ["sell_side", TYPE_LABEL.sell_side], ["buy_side", TYPE_LABEL.buy_side], ["official", TYPE_LABEL.official],
    ["model", "Hard-data model"], ["consensus", "Blended consensus"],
  ];
  document.getElementById("legend").replaceChildren(...items.map(([t, label]) => {
    const color = t in TYPE_VAR ? css(TYPE_VAR[t]) : css("--ink");
    const icon = svg("svg", { width: 14, height: 14, viewBox: "-7 -7 14 14", "aria-hidden": "true" },
      t === "consensus"
        ? svg("circle", { r: 5, fill: "none", stroke: color, "stroke-width": 2 })
        : svg("path", { d: markerPath(t, 4.5), fill: color }));
    return el("li", {}, icon, label);
  }));
}

function renderChart() {
  const host = document.getElementById("chart");
  const W = Math.max(320, host.clientWidth || 800);
  const H = Math.round(Math.min(680, Math.max(360, W * 0.72)));
  const m = { t: 18, r: 18, b: 44, l: 52 };
  const pts = points();
  const k = CI_K[state.ci];
  // Fit the range to the points (plus a margin), not to the ellipses; ellipses are clipped to the plot.
  const xs = pts.flatMap((p) => [p.x - 0.6, p.x + 0.6]);
  const ys = pts.flatMap((p) => [p.y - 0.6, p.y + 0.6]);
  if (state.trail) for (const h of trailSeries().flat()) { xs.push(h.x); ys.push(h.y); }
  const [x0, x1] = niceDomain(xs, 2.5);
  const [y0, y1] = niceDomain(ys, 2.5);
  const X = (v) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const sxPx = (v) => (v / (x1 - x0)) * (W - m.l - m.r);
  const syPx = (v) => (v / (y1 - y0)) * (H - m.t - m.b);

  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Growth-inflation quadrant scatter plot" });
  const grid = svg("g");
  const ink2 = css("--ink-2"), muted = css("--muted"), gridC = css("--grid"), axisC = css("--axis"), surface = css("--surface");

  // current-regime wash
  const b = state.snap.blend.blended;
  const cq = quadrantOf(b.x, b.y);
  const qx = cq === "goldilocks" || cq === "overheating" ? [0, x1] : [x0, 0];
  const qy = cq === "overheating" || cq === "stagflation" ? [0, y1] : [y0, 0];
  grid.append(svg("rect", { x: X(qx[0]), y: Y(qy[1]), width: X(qx[1]) - X(qx[0]), height: Y(qy[0]) - Y(qy[1]), fill: css("--wash") }));

  // gridlines + ticks
  for (let v = Math.ceil(x0 * 2) / 2; v <= x1 + 1e-9; v += 0.5) {
    if (Math.abs(v) < 1e-9) continue;
    const major = Math.abs(v % 1) < 1e-9;
    grid.append(svg("line", { x1: X(v), x2: X(v), y1: m.t, y2: H - m.b, stroke: gridC, "stroke-width": major ? 1 : 0.5 }));
    if (major) grid.append(svg("text", { x: X(v), y: H - m.b + 16, "text-anchor": "middle", "font-size": 11, fill: muted, "font-variant-numeric": "tabular-nums", text: fmt(v, 0) }));
  }
  for (let v = Math.ceil(y0 * 2) / 2; v <= y1 + 1e-9; v += 0.5) {
    if (Math.abs(v) < 1e-9) continue;
    const major = Math.abs(v % 1) < 1e-9;
    grid.append(svg("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: gridC, "stroke-width": major ? 1 : 0.5 }));
    if (major) grid.append(svg("text", { x: m.l - 8, y: Y(v) + 4, "text-anchor": "end", "font-size": 11, fill: muted, text: fmt(v, 0) }));
  }
  // zero axes
  grid.append(svg("line", { x1: X(0), x2: X(0), y1: m.t, y2: H - m.b, stroke: axisC, "stroke-width": 1.5 }));
  grid.append(svg("line", { x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0), stroke: axisC, "stroke-width": 1.5 }));
  grid.append(svg("text", { x: X(0), y: H - m.b + 16, "text-anchor": "middle", "font-size": 11, fill: muted, text: "0" }));
  // axis titles
  grid.append(svg("text", { x: W - m.r, y: H - 8, "text-anchor": "end", "font-size": 12, fill: ink2, text: "Growth vs trend (pp) →" }));
  grid.append(svg("text", { x: 14, y: m.t, "text-anchor": "start", "font-size": 12, fill: ink2, transform: `rotate(-90 14 ${m.t}) translate(${-(H - m.t - m.b)} 0)`, text: "Core inflation vs 2% target (pp) →" }));
  // quadrant labels
  const narrow = W < 560;
  const ql = (q, x, y, anchor) => grid.append(svg("text", { x, y, "text-anchor": anchor, "font-size": narrow ? 10.5 : 11.5, "font-weight": 650, fill: muted, "letter-spacing": "0.06em", text: (narrow && q === "slowdown" ? "Slowdown" : QUAD_NAMES[q]).toUpperCase() }));
  ql("stagflation", m.l + 10, m.t + 16, "start");
  ql("overheating", W - m.r - 10, m.t + 16, "end");
  ql("slowdown", m.l + 10, H - m.b - 10, "start");
  ql("goldilocks", W - m.r - 10, H - m.b - 10, "end");
  root.append(grid);

  // history trails
  if (state.trail) {
    const [modelTrail, consTrail] = trailSeries();
    const tg = svg("g", { "aria-hidden": "true" });
    const line = (arr, dash, color, w) => {
      if (arr.length < 2) return;
      tg.append(svg("polyline", { points: arr.map((h) => `${X(h.x)},${Y(h.y)}`).join(" "), fill: "none", stroke: color, "stroke-width": w, "stroke-dasharray": dash, "stroke-linejoin": "round", opacity: 0.55 }));
      arr.forEach((h, i) => tg.append(svg("circle", { cx: X(h.x), cy: Y(h.y), r: 2.5, fill: color, opacity: 0.25 + 0.5 * (i / arr.length) })));
      const first = arr[0];
      tg.append(svg("text", { x: X(first.x) + 5, y: Y(first.y) - 5, "font-size": 10.5, fill: muted, text: first.as_of.slice(0, 7) }));
    };
    line(modelTrail, "2 3", ink2, 1.25);
    line(consTrail, null, ink2, 1.5);
    root.append(tg);
  }

  // ellipses
  root.append(svg("defs", {}, svg("clipPath", { id: "plot-clip" }, svg("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b }))));
  const eg = svg("g", { class: "ellipses", "clip-path": "url(#plot-clip)" });
  for (const p of pts) {
    const c = colorOf(p);
    eg.append(svg("ellipse", {
      "data-key": p.key, "data-kind": p.kind,
      cx: X(p.x), cy: Y(p.y), rx: sxPx(p.sx * k), ry: syPx(p.sy * k),
      fill: p.stale ? "none" : c, stroke: c,
      "stroke-dasharray": p.stale ? "4 3" : p.kind === "model" ? "6 3" : null,
    }));
  }
  root.append(eg);

  // arrows
  if (state.arrows) {
    const defs = svg("defs");
    const ag = svg("g");
    for (const p of pts) {
      if (!p.dx && !p.dy) continue;
      const c = colorOf(p);
      const id = `ah-${p.key}`;
      defs.append(svg("marker", { id, viewBox: "0 0 8 8", refX: 6, refY: 4, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" },
        svg("path", { d: "M0,0.5L7,4L0,7.5z", fill: c })));
      const len = 0.5; // 1 unit of direction = 0.5pp on the chart
      ag.append(svg("line", { x1: X(p.x), y1: Y(p.y), x2: X(p.x + p.dx * len), y2: Y(p.y + p.dy * len), stroke: c, "stroke-width": 1.5, "marker-end": `url(#${id})`, opacity: p.stale ? 0.4 : 0.85 }));
    }
    root.append(defs, ag);
  }

  // markers
  const mg = svg("g");
  const placed = [];
  const nodes = [];
  for (const p of pts) {
    const c = colorOf(p);
    const g = svg("g", { class: "pt", "data-key": p.key, transform: `translate(${X(p.x)},${Y(p.y)})`, tabindex: 0, role: "button", "aria-label": `${p.name}: growth ${fmt(p.x)} pp, inflation ${fmt(p.y)} pp` });
    g.append(svg("circle", { class: "hit", r: 14, fill: "transparent" }));
    if (p.kind === "consensus") {
      g.append(svg("circle", { r: 9, fill: surface, "fill-opacity": 0.6, stroke: c, "stroke-width": 2.5 }));
      g.append(svg("circle", { r: 2.5, fill: c }));
    } else {
      const r = p.kind === "model" ? 6 : 5.5;
      g.append(svg("path", { d: markerPath(p.type, r), fill: p.stale ? surface : c, stroke: p.stale ? c : surface, "stroke-width": 2, "paint-order": "stroke" }));
    }
    g.addEventListener("pointerenter", (e) => hoverOn(p, e));
    g.addEventListener("pointermove", (e) => moveTip(e));
    g.addEventListener("pointerleave", hoverOff);
    g.addEventListener("focus", () => hoverOn(p, null, g));
    g.addEventListener("blur", hoverOff);
    g.addEventListener("click", () => select(p.key));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(p.key); } });
    mg.append(g);
    nodes.push(p);
    placed.push({ x: X(p.x) - 8, y: Y(p.y) - 8, w: 16, h: 16 });
  }
  root.append(mg);

  // direct labels with greedy collision avoidance
  const lg = svg("g", { "pointer-events": "none" });
  root.append(lg);
  host.replaceChildren(root);
  const order = [...nodes].sort((a, b) => (a.kind === "view") - (b.kind === "view"));
  for (const p of order) {
    const px = X(p.x), py = Y(p.y);
    const t = svg("text", { "font-size": p.kind === "view" ? 11.5 : 12, "font-weight": p.kind === "view" ? 550 : 700, fill: p.kind === "view" ? ink2 : css("--ink"), text: p.label, stroke: surface, "stroke-width": 3, "paint-order": "stroke", "stroke-linejoin": "round" });
    lg.append(t);
    const bw = t.getComputedTextLength() + 2, bh = 13;
    const cands = [[10, 4, "start"], [-10, 4, "end"], [0, -12, "middle"], [0, 20, "middle"], [10, -10, "start"], [-10, -10, "end"], [10, 16, "start"], [-10, 16, "end"]];
    let best = null;
    for (const [ox, oy, anchor] of cands) {
      const lx = anchor === "start" ? px + ox : anchor === "end" ? px + ox - bw : px - bw / 2;
      const box = { x: lx, y: py + oy - bh + 3, w: bw, h: bh };
      if (box.x < m.l || box.x + box.w > W - m.r || box.y < m.t || box.y + box.h > H - m.b) continue;
      const hits = placed.filter((q) => !(box.x + box.w < q.x || q.x + q.w < box.x || box.y + box.h < q.y || q.y + q.h < box.y)).length;
      if (!best || hits < best.hits) best = { hits, ox, oy, anchor, box };
      if (hits === 0) break;
    }
    if (!best) { t.remove(); continue; }
    t.setAttribute("x", px + best.ox); t.setAttribute("y", py + best.oy); t.setAttribute("text-anchor", best.anchor);
    t.setAttribute("data-key", p.key);
    placed.push(best.box);
  }
  applyFocus();
}

// Hover/selection only restyles existing nodes; the SVG is rebuilt only when data or options change.
function applyFocus() {
  const focus = state.hover || state.selected;
  for (const e of document.querySelectorAll(".chart ellipse")) {
    const key = e.dataset.key, kind = e.dataset.kind, strong = key === focus;
    const show = state.allEllipses || kind !== "view" || strong;
    e.style.display = show ? "" : "none";
    e.setAttribute("fill-opacity", kind === "view" ? (strong ? 0.12 : 0.05) : strong ? 0.08 : 0.03);
    e.setAttribute("stroke-opacity", strong ? 0.9 : 0.45);
    e.setAttribute("stroke-width", strong ? 1.5 : 1);
  }
  for (const n of document.querySelectorAll(".chart .pt, .chart text[data-key]")) {
    n.classList.toggle("dim", Boolean(state.hover) && n.dataset.key !== state.hover);
  }
}

function trailSeries() {
  const s = state.snap;
  const byDate = new Map();
  for (const h of s.model.history || []) byDate.set(h.as_of, { as_of: h.as_of, x: h.x, y: h.y });
  for (const h of state.history) if (h.model) byDate.set(h.as_of, { as_of: h.as_of, x: h.model.x, y: h.model.y });
  byDate.set(s.as_of, { as_of: s.as_of, x: s.model.point.x, y: s.model.point.y });
  const model = [...byDate.values()].sort((a, b) => a.as_of.localeCompare(b.as_of)).slice(-18);
  const cons = state.history.filter((h) => h.consensus && !h.backfill).map((h) => ({ as_of: h.as_of, x: h.consensus.x, y: h.consensus.y }));
  if (!cons.some((c) => c.as_of === s.as_of)) cons.push({ as_of: s.as_of, x: s.blend.blended.x, y: s.blend.blended.y });
  return [model, cons.slice(-26)];
}

// ------------------------------------------------------------------ tooltip

function hoverOn(p, e, node) {
  state.hover = p.key;
  const tip = document.getElementById("tooltip");
  const extra = p.kind === "view" ? `${p.src.published || "n.d."}${p.stale ? " · stale" : ""} · ${QUAD_NAMES[quadrantOf(p.x, p.y)]}`
    : p.kind === "model" ? `${state.snap.model.indicators.length} FRED indicators · ${QUAD_NAMES[quadrantOf(p.x, p.y)]}`
    : `Mixture of all views + hard data · ${QUAD_NAMES[quadrantOf(p.x, p.y)]}`;
  tip.replaceChildren(
    el("div", { class: "v", text: `Growth ${fmt(p.x)} · Inflation ${fmt(p.y)} pp` }),
    el("div", { class: "n" }, el("span", { class: "key", style: `background:${colorOf(p)}` }), p.name),
    el("div", { class: "m", text: `±${p.sx.toFixed(2)} / ±${p.sy.toFixed(2)} pp (1σ) · ${extra}` }),
  );
  tip.hidden = false;
  if (e) moveTip(e);
  else if (node) {
    const r = node.getBoundingClientRect();
    moveTip({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
  }
  applyFocus();
}
function moveTip(e) {
  const tip = document.getElementById("tooltip");
  const card = tip.parentElement.getBoundingClientRect();
  let x = e.clientX - card.left + 14, y = e.clientY - card.top + 14;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  if (x + tw > card.width - 8) x = e.clientX - card.left - tw - 14;
  if (y + th > card.height - 8) y = e.clientY - card.top - th - 14;
  tip.style.left = `${Math.max(8, x)}px`; tip.style.top = `${Math.max(8, y)}px`;
}
function hoverOff() {
  state.hover = null;
  document.getElementById("tooltip").hidden = true;
  applyFocus();
}

// ------------------------------------------------------------------ detail panel

function select(key) {
  state.selected = key;
  renderDetail();
  applyFocus();
  for (const tr of document.querySelectorAll("#views-table tbody tr")) tr.classList.toggle("sel", tr.dataset.id === key);
}

function coords(x, sx, y, sy) {
  return el("div", { class: "coords" },
    el("div", {}, el("div", { class: "l", text: "Growth gap" }), el("div", { class: "v", text: `${fmt(x)} pp` }), el("div", { class: "s", text: `±${sx.toFixed(2)} (1σ)` })),
    el("div", {}, el("div", { class: "l", text: "Inflation gap" }), el("div", { class: "v", text: `${fmt(y)} pp` }), el("div", { class: "s", text: `±${sy.toFixed(2)} (1σ)` })),
  );
}

function renderDetail() {
  const box = document.getElementById("detail");
  const s = state.snap;
  const key = state.selected;
  const parts = [];
  if (key === "consensus") {
    const b = s.blend.blended;
    parts.push(el("h3", { text: "Blended consensus" }),
      el("div", { class: "meta" }, el("span", { class: "chip", text: QUAD_NAMES[quadrantOf(b.x, b.y)] }), el("span", { class: "chip", text: `Hard data weight ${pct(s.blend.model_weight_share)}` })),
      coords(b.x, b.sx, b.y, b.sy),
      el("p", { text: s.synthesis?.consensus_vs_data || "" }),
      el("h4", { text: "Houses only vs hard data" }),
      el("table", { class: "nums" }, el("tbody", {},
        el("tr", {}, el("td", { text: "Houses (mixture)" }), el("td", { text: `${fmt(s.blend.houses.x)} / ${fmt(s.blend.houses.y)}` }), el("td", { text: QUAD_NAMES[quadrantOf(s.blend.houses.x, s.blend.houses.y)] })),
        el("tr", {}, el("td", { text: "Hard-data model" }), el("td", { text: `${fmt(s.model.point.x)} / ${fmt(s.model.point.y)}` }), el("td", { text: QUAD_NAMES[s.model.point.quadrant] })),
      )));
  } else if (key === "data_model") {
    const p = s.model.point;
    const top = [...s.model.indicators].sort((a, b) => Math.abs(b.gap * b.weight) - Math.abs(a.gap * a.weight)).slice(0, 5);
    parts.push(el("h3", { text: "Hard-data model (FRED)" }),
      el("div", { class: "meta" }, el("span", { class: "chip", text: QUAD_NAMES[p.quadrant] }), el("span", { class: "chip", text: `${s.model.indicators.length} indicators` })),
      coords(p.x, p.sx, p.y, p.sy),
      el("p", { class: "small", text: `3-month momentum: growth ${fmt(p.dx)} pp, inflation ${fmt(p.dy)} pp.` }),
      el("h4", { text: "Biggest contributors" }),
      el("table", { class: "nums" }, el("tbody", {}, top.map((r) => el("tr", {}, el("td", { text: r.label }), el("td", { text: `${fmt(r.gap)}` }), el("td", { text: r.axis }))))),
      el("p", { class: "rationale", text: s.model.caveat || "" }));
  } else {
    const v = s.views.find((x) => x.id === key);
    if (!v) { state.selected = "consensus"; return renderDetail(); }
    const url = safeUrl(v.url);
    parts.push(el("h3", { text: v.name }),
      el("div", { class: "meta" },
        el("span", { class: "chip" }, el("span", { class: "key", style: `background:${css(TYPE_VAR[v.type] || "--ink")}` }), TYPE_LABEL[v.type] || v.type),
        el("span", { class: `chip${v.stale ? " stale" : ""}`, text: `${v.published || "n.d."}${v.age_days != null ? ` · ${v.age_days}d ago` : ""}${v.stale ? " · stale" : ""}` }),
        el("span", { class: "chip", text: `Confidence: ${v.confidence}` })),
      url ? el("p", {}, el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: v.title || url })) : el("p", { text: v.title || "" }),
      coords(v.x, v.sx, v.y, v.sy),
      el("p", { text: v.summary }),
      v.forecast_numbers?.length ? [el("h4", { text: "Forecast numbers" }), el("table", { class: "nums" }, el("tbody", {}, v.forecast_numbers.map((f) => el("tr", {}, el("td", { text: f.metric }), el("td", { text: f.value }), el("td", { text: f.period })))))] : null,
      v.key_points?.length ? [el("h4", { text: "Key points" }), el("ul", { class: "bullets" }, v.key_points.map((k) => el("li", { text: k })))] : null,
      v.quotes?.length ? [el("h4", { text: "In their words" }), v.quotes.map((q) => el("blockquote", { text: `“${q}”` }))] : null,
      el("h4", { text: "How it was scored" }),
      el("p", { class: "rationale", text: `${v.scoring_rationale || ""} (${v.method || "?"})` }));
  }
  parts.push(el("p", { class: "muted small hint", text: "Click any point or table row to inspect it." }));
  box.replaceChildren(...parts.flat().filter(Boolean));
}

// ------------------------------------------------------------------ data-supports + tables

const SUPPORT_LABEL = { above_trend: "Above trend", below_trend: "Below trend", above_target: "Above target", below_target: "Below target", neutral: "Neutral" };

function renderSupports() {
  const s = state.snap, syn = s.synthesis || {};
  document.getElementById("data-supports").textContent = syn.data_supports || "";
  document.getElementById("consensus-vs-data").textContent = syn.consensus_vs_data || "";
  document.getElementById("synth-method").textContent = syn.method ? `written by: ${syn.method}` : "";
  document.getElementById("divergences").replaceChildren(...(syn.divergences || []).map((d) => el("li", { text: d })));
  document.getElementById("watch").replaceChildren(...(syn.watch_list || []).map((d) => el("li", { text: d })));

  const tbody = document.querySelector("#indicators tbody");
  const rows = [];
  for (const axis of ["growth", "inflation"]) {
    const agg = s.model.point;
    const mean = axis === "growth" ? agg.x : agg.y;
    rows.push(el("tr", { class: "axis-row" }, el("td", { colspan: 5, text: `${axis === "growth" ? "Growth" : "Inflation"} — model ${fmt(mean)} pp` })));
    for (const r of s.model.indicators.filter((i) => i.axis === axis)) {
      const lim = 3, g = Math.max(-lim, Math.min(lim, r.gap));
      const left = g >= 0 ? 50 : 50 + (g / lim) * 50, width = Math.abs(g / lim) * 50;
      rows.push(el("tr", { title: r.note },
        el("td", { text: r.label }),
        el("td", { class: "num", text: `${r.value.toFixed(2)}${r.unit === "%" ? "%" : r.unit === "k" ? "k" : ""}` }),
        el("td", { class: "muted", text: r.observation_date || "" }),
        el("td", {}, el("div", { class: "gapbar" },
          el("div", { class: "track", "aria-hidden": "true" }, el("span", { class: `fill${Math.abs(r.gap) < 0.25 ? " weak" : ""}`, style: `left:${left}%;width:${Math.max(width, 0.8)}%` })),
          el("span", { class: "gv", text: fmt(r.gap) }))),
        el("td", { class: "sup", text: SUPPORT_LABEL[r.supports] || r.supports }),
      ));
    }
  }
  tbody.replaceChildren(...rows);
}

function renderViewsTable() {
  const s = state.snap;
  const rows = [...s.views].sort((a, b) => b.y - a.y).map((v) => {
    const color = css(TYPE_VAR[v.type] || "--ink");
    const icon = svg("svg", { class: "shape", width: 12, height: 12, viewBox: "-6 -6 12 12", "aria-hidden": "true" }, svg("path", { d: markerPath(v.type, 4.5), fill: v.stale ? "none" : color, stroke: color, "stroke-width": 1.5 }));
    return el("tr", { "data-id": v.id, tabindex: 0, onclick: () => select(v.id), onkeydown: (e) => { if (e.key === "Enter") select(v.id); } },
      el("td", {}, icon, v.name),
      el("td", { text: TYPE_LABEL[v.type] || v.type }),
      el("td", { text: `${v.published || "n.d."}${v.stale ? " (stale)" : ""}` }),
      el("td", { class: "num", text: `${fmt(v.x)} ±${v.sx.toFixed(1)}` }),
      el("td", { class: "num", text: `${fmt(v.y)} ±${v.sy.toFixed(1)}` }),
      el("td", { text: QUAD_NAMES[quadrantOf(v.x, v.y)] }),
      el("td", { text: v.confidence }));
  });
  document.querySelector("#views-table tbody").replaceChildren(...rows);
}

// ------------------------------------------------------------------ controls

function bindSeg(id, attr, onPick) {
  const box = document.getElementById(id);
  box.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    for (const x of box.querySelectorAll("button")) x.setAttribute("aria-checked", String(x === b));
    onPick(b.dataset[attr]);
  });
}

function bindControls() {
  bindSeg("prob-basis", "basis", (v) => { state.basis = v; renderTiles(); });
  bindSeg("ci", "ci", (v) => { state.ci = v; renderChart(); });
  const chk = (id, key) => document.getElementById(id).addEventListener("change", (e) => { state[key] = e.target.checked; renderChart(); });
  document.getElementById("opt-ellipses").addEventListener("change", (e) => { state.allEllipses = e.target.checked; applyFocus(); }); chk("opt-arrows", "arrows"); chk("opt-trail", "trail"); chk("opt-stale", "showStale");
  let t = 0;
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(renderChart, 120); });

  const saved = store.get("giq-theme");
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("giq-theme", next);
    renderAll();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => renderAll());
}

function renderAll() {
  if (!state.snap) return;
  renderHero(); renderLegend(); renderChart(); renderDetail(); renderSupports(); renderViewsTable();
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
