// g-i-q frontend. Reads everything from the backend API; never needs redeploying for data updates.

const SVGNS = "http://www.w3.org/2000/svg";
const QUAD_NAMES = {
  goldilocks: "Goldilocks",
  overheating: "Overheating / Reflation",
  stagflation: "Stagflation",
  slowdown: "Disinflationary slowdown",
};
const QUAD_SHORT = {
  goldilocks: "Goldilocks",
  overheating: "Overheating",
  stagflation: "Stagflation",
  slowdown: "Slowdown",
};
function quadDesc(q) {
  const g = trendBase().toFixed(1), p = targetBase().toFixed(1);
  return {
    goldilocks: `GDP > ${g}% · PCE < ${p}%`,
    overheating: `GDP > ${g}% · PCE > ${p}%`,
    stagflation: `GDP < ${g}% · PCE > ${p}%`,
    slowdown: `GDP < ${g}% · PCE < ${p}%`,
  }[q];
}
const QUAD_COLOR = {
  goldilocks: "--q-goldilocks",
  overheating: "--q-overheating",
  stagflation: "--q-stagflation",
  slowdown: "--q-slowdown",
};
const TYPE_LABEL = { sell_side: "Sell-side bank", buy_side: "Asset manager", official: "Official sector" };
const TYPE_SHORT = { sell_side: "Sell-side", buy_side: "Buy-side", official: "Official" };
const TYPE_VAR = { sell_side: "--sell", buy_side: "--buy", official: "--official" };

const IND_CATEGORY = {
  gdpnow: "Nowcast",
  gdp: "Output",
  cfnai: "Activity",
  indpro: "Output",
  retail: "Spending",
  payrolls: "Labor",
  unemp: "Labor",
  claims: "Labor",
  nfci: "Financial",
  core_pce_yoy: "Realized",
  core_pce_3m: "Momentum",
  core_cpi_3m: "Momentum",
  cpi_6m: "Headline",
  be10: "Market BE",
  fwd5y5y: "Market BE",
  umich: "Survey",
};

// k = sqrt(chi-square quantile, 2 dof): radius scale of a bivariate normal confidence region
const CI_K = { "68": Math.sqrt(-2 * Math.log(1 - 0.68)), "90": Math.sqrt(-2 * Math.log(1 - 0.9)) };

const state = {
  snap: null,
  latestDate: null,
  snapshots: [],
  activeDate: null,
  history: [],
  basis: "blended",
  zoom: "cluster",
  ciMode: "focus-68", // focus-68 | focus-90 | all-68 | all-90 | off
  arrows: true,
  trail: true,
  showStale: true,
  showRules: false,
  selected: "consensus",
  expandedRow: null,
  hover: null,
  filter: "all",
  sort: "weight",
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
  for (const c of kids.flat(Infinity)) {
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
  for (const c of kids.flat(Infinity)) if (c) n.append(c);
  return n;
}

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fmt = (v, d = 2) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(d);
const pct = (v) => `${Math.round((v || 0) * 100)}%`;
const trendBase = () => state.snap?.params?.trend_growth ?? 2.0;
const targetBase = () => state.snap?.params?.inflation_target ?? 2.0;
const fmtLevel = (gap, base, d = 2) => `${(base + gap).toFixed(d)}%`;

function cleanPctTick(base, gap) {
  const s = (base + gap).toFixed(2);
  return s.endsWith("0") ? `${s.slice(0, -1)}%` : `${s}%`;
}

function cleanGapTick(v) {
  const s = Math.abs(v).toFixed(2);
  const trimmed = s.endsWith("0") ? s.slice(0, -1) : s;
  return (v >= 0 ? "+" : "−") + trimmed;
}

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
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

function quadrantOf(x, y) {
  return x >= 0 ? (y >= 0 ? "overheating" : "goldilocks") : (y >= 0 ? "stagflation" : "slowdown");
}

function dirWord(dx, dy) {
  const g = dx > 0.12 ? "↗" : dx < -0.12 ? "↘" : "→";
  const p = dy > 0.12 ? "↗" : dy < -0.12 ? "↘" : "→";
  return `Growth ${g} · PCE ${p}`;
}

function policyBadge(v) {
  const f = (v.forecast_numbers || []).find((x) => /fed|terminal|recession|rate/i.test(x.metric));
  if (f) return `${f.metric}: ${f.value}`;
  return null;
}

// ------------------------------------------------------------------ data

function apiBase() {
  const q = new URLSearchParams(location.search).get("api");
  const base = q || (window.GIQ_CONFIG && window.GIQ_CONFIG.apiBase) || "";
  return base.replace(/\/+$/, "");
}

async function loadInitial() {
  const base = apiBase();
  const [latest, hist, snaps] = await Promise.all([
    fetch(`${base}/api/latest`).then((r) => {
      if (!r.ok) throw new Error(`/api/latest → HTTP ${r.status}`);
      return r.json();
    }),
    fetch(`${base}/api/history?limit=260`).then((r) => (r.ok ? r.json() : { points: [] })).catch(() => ({ points: [] })),
    fetch(`${base}/api/snapshots`).then((r) => (r.ok ? r.json() : { dates: [] })).catch(() => ({ dates: [] })),
  ]);
  state.snap = latest;
  state.latestDate = latest.as_of;
  state.activeDate = latest.as_of;
  state.history = hist.points || [];
  state.snapshots = Array.isArray(snaps.dates) && snaps.dates.length ? snaps.dates : [latest.as_of];
  if (!state.snapshots.includes(latest.as_of)) state.snapshots.push(latest.as_of);
  state.snapshots.sort();
}

async function loadSnapshotDate(dateStr) {
  const base = apiBase();
  const path = dateStr === state.latestDate ? "/api/latest" : `/api/snapshot/${dateStr}`;
  const snap = await fetch(`${base}${path}`).then((r) => {
    if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
    return r.json();
  });
  state.snap = snap;
  state.activeDate = snap.as_of;
  state.expandedRow = null;
  if (state.selected !== "consensus" && state.selected !== "data_model" && !snap.views.some((v) => v.id === state.selected)) {
    state.selected = "consensus";
  }
  renderAll();
}

function points() {
  const s = state.snap;
  const views = s.views.filter((v) => state.showStale || !v.stale);
  const m = s.model.point;
  const b = s.blend.blended;
  return [
    ...views.map((v) => ({
      kind: "view", key: v.id, label: v.short || v.name, name: v.name, type: v.type,
      x: v.x, y: v.y, sx: v.sx, sy: v.sy, dx: v.dx, dy: v.dy, stale: v.stale, src: v,
    })),
    {
      kind: "model", key: "data_model", label: "Hard data", name: m.name, type: "model",
      x: m.x, y: m.y, sx: m.sx, sy: m.sy, dx: m.dx, dy: m.dy, src: m,
    },
    {
      kind: "consensus", key: "consensus", label: "Blended", name: "Blended consensus", type: "consensus",
      x: b.x, y: b.y, sx: b.sx, sy: b.sy, src: b,
    },
  ];
}

function colorOf(p) {
  if (p.type === "consensus") return css("--consensus");
  if (p.type in TYPE_VAR) return css(TYPE_VAR[p.type]);
  return css("--ink");
}

// ------------------------------------------------------------------ deterministic insight synthesis

function computeTensionInsights(s) {
  const syn = s.synthesis || {};
  const trend = trendBase();
  const target = targetBase();
  const views = s.views || [];
  const fresh = views.filter((v) => !v.stale);
  const pool = fresh.length >= 2 ? fresh : views;
  const m = s.model.point;
  const h = s.blend.houses;

  // Prose comparison
  let prose = syn.consensus_vs_data || "";
  if (!prose || syn.method === "template") {
    const gapG = m.x - h.x;
    const coolingN = views.filter((v) => (v.dy || 0) < -0.1).length;
    const diffDesc = Math.abs(gapG) >= 0.25
      ? `Hard data is running ${Math.abs(gapG).toFixed(2)}pp ${gapG > 0 ? "hotter" : "softer"} on growth than house consensus (${fmtLevel(m.x, trend)} vs ${fmtLevel(h.x, trend)}).`
      : `Hard data and house consensus sit within ${Math.abs(gapG).toFixed(2)}pp on growth (${fmtLevel(m.x, trend)} vs ${fmtLevel(h.x, trend)}).`;
    const trajDesc = views.length && coolingN >= Math.ceil(views.length / 2) && (m.dy || 0) > 0.1
      ? ` ${coolingN} of ${views.length} houses project inflation cooling over 6–12m, even as 3m realized momentum is still rising (${fmt(m.dy)}pp).`
      : "";
    prose = diffDesc + trajDesc;
  }

  // Divergences bullets
  let divs = Array.isArray(syn.divergences) && syn.divergences.length ? [...syn.divergences] : [];
  if (!divs.length && pool.length >= 2) {
    const byG = [...pool].sort((a, b) => a.x - b.x);
    const byP = [...pool].sort((a, b) => a.y - b.y);
    const loG = byG[0], hiG = byG[byG.length - 1];
    const loP = byP[0], hiP = byP[byP.length - 1];
    divs.push(
      `Growth range (${pool === fresh ? "fresh" : "all"}): ${loG.short || loG.name} (${fmtLevel(loG.x, trend)}) to ${hiG.short || hiG.name} (${fmtLevel(hiG.x, trend)}), vs hard data at ${fmtLevel(m.x, trend)}.`,
      `Inflation range (${pool === fresh ? "fresh" : "all"}): ${loP.short || loP.name} (${fmtLevel(loP.y, target)}) to ${hiP.short || hiP.name} (${fmtLevel(hiP.y, target)}).`
    );
    const be = s.model.indicators.filter((i) => i.id === "be10" || i.id === "fwd5y5y");
    if (be.length && be.every((i) => Math.abs(i.gap) <= 0.25) && m.y > 0.25) {
      divs.push(`Realized vs expectations: core PCE runs hot (${fmtLevel(m.y, target)} composite), yet 10y/5y5y market breakevens (${be.map((i) => `${i.value.toFixed(2)}%`).join(", ")}) remain anchored.`);
    }
  }

  return { prose, divs, watch: Array.isArray(syn.watch_list) ? syn.watch_list : [] };
}

// ------------------------------------------------------------------ topbar + status + hero

function renderChrome() {
  const s = state.snap;
  const trend = trendBase();
  const target = targetBase();
  document.getElementById("baselines-sub").textContent =
    `US 6–12m macro outlook · Trend GDP ${trend.toFixed(1)}% · Core PCE target ${target.toFixed(1)}%`;

  // Snapshot picker
  const pickerWrap = document.getElementById("snap-picker-wrap");
  const selectEl = document.getElementById("snapshot-select");
  if (state.snapshots.length > 1) {
    pickerWrap.hidden = false;
    selectEl.replaceChildren(
      ...[...state.snapshots].reverse().map((d) =>
        el("option", { value: d, selected: d === state.activeDate, text: d === state.latestDate ? `${d} (Latest)` : d })
      )
    );
  } else {
    pickerWrap.hidden = true;
  }

  // Coverage & delta status strip
  const strip = document.getElementById("status-strip");
  const items = document.getElementById("status-items");
  const totalSources = (s.sources || []).length || s.views.length;
  const freshCount = s.views.filter((v) => !v.stale).length;
  const staleCount = s.views.filter((v) => v.stale).length;
  const presentIds = new Set(s.views.map((v) => v.id));
  const missing = (s.sources || []).filter((src) => !presentIds.has(src.id)).map((src) => src.short || src.name);

  const chips = [
    el("span", { class: "status-item" }, "As of ", el("strong", { text: s.as_of })),
    el("span", { class: "status-item" }, "Tracked: ", el("strong", { text: `${s.views.length}/${totalSources} houses` }), ` (${freshCount} fresh${staleCount ? `, ${staleCount} stale` : ""})`),
  ];
  if (missing.length) {
    chips.push(el("span", { class: "status-item warn" }, "No recent score: ", el("strong", { text: missing.join(", ") })));
  }

  // Compare with ~1m ago model history if available
  const mHist = s.model?.history || [];
  if (mHist.length >= 2) {
    const prev = mHist[mHist.length - 1];
    if (prev && prev.as_of !== s.as_of) {
      const dx = s.model.point.x - prev.x;
      const dy = s.model.point.y - prev.y;
      chips.push(el("span", { class: "status-item" }, `Hard-data Δ vs ${prev.as_of.slice(0, 7)}: `, el("strong", { text: `GDP ${fmt(dx)}pp · PCE ${fmt(dy)}pp` })));
    }
  }
  if (state.activeDate && state.latestDate && state.activeDate !== state.latestDate) {
    chips.push(el("span", { class: "status-item warn" }, el("strong", { text: `Archived view (${state.activeDate})` })));
  }

  items.replaceChildren(...chips);
  strip.hidden = false;
  document.getElementById("back-latest").hidden = !(state.activeDate && state.latestDate && state.activeDate !== state.latestDate);

  document.getElementById("footer-gen").textContent =
    `Generated ${s.generated_at?.replace("T", " ").replace("+00:00", " UTC") || s.as_of}`;
}

function renderHero() {
  const s = state.snap;
  const trend = trendBase();
  const target = targetBase();
  const basisObj = s.blend[state.basis] || s.blend.blended;
  const probs = basisObj.probabilities;
  const topQ = Object.keys(probs).reduce((a, b) => (probs[a] >= probs[b] ? a : b));

  document.getElementById("regime-dot").style.background = css(QUAD_COLOR[topQ]);
  document.getElementById("regime-label").textContent = QUAD_NAMES[topQ];

  // Headline: prefer rich custom/LLM headline when on blended lens; otherwise synthesize clear level-first headline
  const syn = s.synthesis || {};
  const useCustomHeadline = state.basis === "blended" && syn.headline && syn.method && syn.method !== "template";
  document.getElementById("headline").textContent = useCustomHeadline
    ? syn.headline
    : `${QUAD_NAMES[topQ]} (${pct(probs[topQ])}): US growth ~${fmtLevel(basisObj.x, trend, 1)}, core PCE ~${fmtLevel(basisObj.y, target, 1)}`;

  const freshCount = s.views.filter((v) => !v.stale).length;
  const sameQuad = s.views.filter((v) => !v.stale && quadrantOf(v.x, v.y) === topQ).length;
  document.getElementById("hero-subline").textContent =
    state.basis === "model"
      ? `Based on ${s.model.indicators.length} FRED series. Realized growth and core inflation sit clearly above baseline, while long-term market breakevens stay anchored.`
      : `${sameQuad} of ${freshCount} fresh institutions sit in ${QUAD_SHORT[topQ]}. ${
          s.model.point.x - s.blend.houses.x > 0.25
            ? "Hard data runs hotter on growth because institutions are already pricing a slowdown ahead."
            : "Hard data and Wall Street views are closely aligned on growth and inflation."
        }`;

  // KPI Strip
  const kpiG = document.getElementById("kpi-gdp");
  const kpiGGap = document.getElementById("kpi-gdp-gap");
  kpiG.textContent = fmtLevel(basisObj.x, trend);
  kpiGGap.textContent = `${fmt(basisObj.x)}pp vs ${trend.toFixed(1)}%`;
  kpiGGap.className = `kpi-gap ${basisObj.x >= 0 ? "hot-g" : "cool"}`;
  document.getElementById("kpi-gdp-compare").textContent =
    `Data ${fmtLevel(s.model.point.x, trend)} · Houses ${fmtLevel(s.blend.houses.x, trend)}`;

  const kpiP = document.getElementById("kpi-pce");
  const kpiPGap = document.getElementById("kpi-pce-gap");
  kpiP.textContent = fmtLevel(basisObj.y, target);
  kpiPGap.textContent = `${fmt(basisObj.y)}pp vs ${target.toFixed(1)}%`;
  kpiPGap.className = `kpi-gap ${basisObj.y >= 0 ? "hot-p" : "hot-g"}`;
  document.getElementById("kpi-pce-compare").textContent =
    `Data ${fmtLevel(s.model.point.y, target)} · Houses ${fmtLevel(s.blend.houses.y, target)}`;

  // Direction & Momentum KPI
  const m = s.model.point;
  const coolingP = s.views.filter((v) => (v.dy || 0) < -0.1).length;
  const coolingG = s.views.filter((v) => (v.dx || 0) < -0.1).length;
  const mArrow = `${m.dx > 0.1 ? "↗" : m.dx < -0.1 ? "↘" : "→"}${m.dy > 0.1 ? "↗" : m.dy < -0.1 ? "↘" : "→"}`;
  const hArrow = `${coolingG >= s.views.length / 2 ? "↘" : "→"}${coolingP >= s.views.length / 2 ? "↘" : "→"}`;
  document.getElementById("kpi-dir").textContent = `Data ${mArrow}`;
  document.getElementById("kpi-dir-gap").textContent = `Houses ${hArrow}`;
  document.getElementById("kpi-dir-gap").className = "kpi-gap";
  document.getElementById("kpi-dir-meta").textContent =
    `${coolingP}/${s.views.length} houses see PCE cooling · 3m ${fmt(m.dx)}/${fmt(m.dy)}pp`;

  // Key tensions & divergences
  const { prose, divs, watch } = computeTensionInsights(s);
  document.getElementById("consensus-vs-data").textContent = prose;
  document.getElementById("synth-method").textContent =
    syn.method && syn.method !== "template" ? `Synthesis: ${syn.method}` : "Auto-synthesized from snapshot";
  document.getElementById("divergences").replaceChildren(...divs.map((d) => el("li", { text: d })));
  const watchWrap = document.getElementById("watch-wrap");
  if (watch.length) {
    watchWrap.hidden = false;
    document.getElementById("watch").replaceChildren(...watch.map((w) => el("li", { text: w })));
  } else {
    watchWrap.hidden = true;
  }

  renderTiles();
  for (const span of document.querySelectorAll("[data-param]")) {
    const v = s.params?.[span.dataset.param];
    span.textContent = v === undefined ? "?" : span.hasAttribute("data-pct") ? pct(v) : String(v);
  }
  const drawsEl = document.getElementById("mc-draws");
  if (drawsEl && s.params?.mc_draws) drawsEl.textContent = `${Math.round(s.params.mc_draws / 1000)}k MC draws`;
}

function renderTiles() {
  const s = state.snap;
  const probs = (s.blend[state.basis] || s.blend.blended).probabilities;
  const top = Object.keys(probs).reduce((a, b) => (probs[a] >= probs[b] ? a : b));

  // Strict 2x2 Cartesian order: top-left Stagflation, top-right Overheating, bottom-left Slowdown, bottom-right Goldilocks
  const order = ["stagflation", "overheating", "slowdown", "goldilocks"];
  const box = document.getElementById("tiles");

  box.replaceChildren(...order.map((q) => {
    const p = probs[q] || 0;
    const isTop = q === top;
    const freshInQ = s.views.filter((v) => !v.stale && quadrantOf(v.x, v.y) === q);
    const staleInQ = s.views.filter((v) => v.stale && quadrantOf(v.x, v.y) === q);
    let note = "";
    if (freshInQ.length || staleInQ.length) {
      const parts = [];
      if (freshInQ.length) parts.push(`${freshInQ.length} fresh`);
      if (staleInQ.length) parts.push(`${staleInQ.length} stale (${staleInQ.map((v) => v.short || v.name).join(", ")})`);
      note = parts.join(" · ");
    } else if (p >= 0.08) {
      note = "Tail risk from uncertainty bands";
    } else {
      note = p >= 0.03 ? "Low probability" : "Negligible odds";
    }

    const col = css(QUAD_COLOR[q]);
    return el("div", { class: `q-cell${isTop ? " active" : ""}` },
      el("div", { class: "q-head" },
        el("div", {},
          el("div", { class: "q-name", text: QUAD_SHORT[q] }),
          el("div", { class: "q-dir", text: quadDesc(q) }),
        ),
        isTop ? el("span", { class: "q-tag", text: "Dominant", style: `color:${col};border-color:${col}` })
          : p >= 0.12 ? el("span", { class: "q-tag", text: "Tail risk", style: `color:${col}` }) : null,
      ),
      el("div", {},
        el("div", { class: "q-prob", text: pct(p), style: isTop ? `color:${col}` : null }),
        el("div", { class: "q-bar", "aria-hidden": "true" },
          el("span", { style: `width:${Math.max(p * 100, p > 0 ? 1.5 : 0)}%;background:${col}` })),
        el("div", { class: "q-note", text: note }),
      ),
    );
  }));
}

// ------------------------------------------------------------------ chart

function niceDomain(vals, step, minSpan, pad, includeZero) {
  let lo = Math.min(...vals, includeZero ? 0 : Infinity) - pad;
  let hi = Math.max(...vals, includeZero ? 0 : -Infinity) + pad;
  if (includeZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (hi - lo < minSpan) {
    const c = (hi + lo) / 2;
    lo = c - minSpan / 2;
    hi = c + minSpan / 2;
  }
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  return [Number(lo.toFixed(4)), Number(hi.toFixed(4))];
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
    ["sell_side", TYPE_SHORT.sell_side],
    ["buy_side", TYPE_SHORT.buy_side],
    ["official", TYPE_SHORT.official],
    ["model", "Hard data"],
    ["consensus", "Blended"],
  ];
  const nodes = items.map(([t, label]) => {
    const color = t === "consensus" ? css("--consensus") : t in TYPE_VAR ? css(TYPE_VAR[t]) : css("--ink");
    const icon = svg("svg", { width: 14, height: 14, viewBox: "-7 -7 14 14", "aria-hidden": "true" },
      t === "consensus"
        ? svg("circle", { r: 5, fill: "none", stroke: color, "stroke-width": 2.2 })
        : svg("path", { d: markerPath(t, 4.5), fill: color }));
    return el("li", {}, icon, label);
  });

  // Add stale & trail legend entries so nothing on screen is unexplained
  nodes.push(el("li", {},
    svg("svg", { width: 14, height: 14, viewBox: "-7 -7 14 14", "aria-hidden": "true" },
      svg("circle", { r: 4.5, fill: "none", stroke: css("--muted"), "stroke-width": 1.6, "stroke-dasharray": "2.5 2" })),
    "Hollow = Stale (>60d)"));
  if (state.trail) {
    nodes.push(el("li", {},
      svg("svg", { width: 16, height: 14, viewBox: "0 0 16 14", "aria-hidden": "true" },
        svg("line", { x1: 1, x2: 15, y1: 7, y2: 7, stroke: css("--ink-2"), "stroke-width": 1.6, "stroke-dasharray": "3 2" })),
      "18m FRED trail"));
  }
  document.getElementById("legend").replaceChildren(...nodes);
}

function renderChart() {
  const host = document.getElementById("chart");
  const pts = points();
  const staleCount = state.snap.views.filter((v) => v.stale).length;
  document.getElementById("stale-label").textContent = `Stale >60d (${staleCount})`;

  const W = Math.max(340, host.clientWidth || 780);
  const H = Math.round(Math.min(620, Math.max(380, W * 0.66)));
  const m = { t: 22, r: 22, b: 54, l: 64 };

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const [modelTrail, consTrail] = trailSeries();

  let x0, x1, y0, y1, step;
  if (state.zoom === "cluster") {
    step = 0.25;
    const includeZeroX = Math.min(...xs) <= 0.35 && Math.max(...xs) >= -0.35;
    const includeZeroY = Math.min(...ys) <= 0.35 && Math.max(...ys) >= -0.35;
    [x0, x1] = niceDomain(xs, step, 1.35, 0.28, includeZeroX);
    [y0, y1] = niceDomain(ys, step, 1.05, 0.22, includeZeroY);
  } else {
    step = 0.5;
    if (state.trail) {
      for (const h of [...modelTrail, ...consTrail]) { xs.push(h.x); ys.push(h.y); }
    }
    [x0, x1] = niceDomain(xs, step, 2.5, 0.35, true);
    [y0, y1] = niceDomain(ys, step, 2.2, 0.35, true);
  }

  const X = (v) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const sxPx = (v) => (v / (x1 - x0)) * (W - m.l - m.r);
  const syPx = (v) => (v / (y1 - y0)) * (H - m.t - m.b);

  const root = svg("svg", { class: "main-svg", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Growth-inflation quadrant scatter plot" });
  root.append(svg("defs", {}, svg("clipPath", { id: "plot-clip" }, svg("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b }))));

  const ink2 = css("--ink-2"), muted = css("--muted"), gridC = css("--grid"), axisC = css("--axis"), surface = css("--surface");
  const trend = trendBase(), target = targetBase();

  // Subtle quadrant washes clipped to plot
  const qWash = svg("g", { "clip-path": "url(#plot-clip)" });
  const drawQRect = (qx0, qx1, qy0, qy1, qName) => {
    const rx0 = Math.max(x0, qx0), rx1 = Math.min(x1, qx1);
    const ry0 = Math.max(y0, qy0), ry1 = Math.min(y1, qy1);
    if (rx1 <= rx0 || ry1 <= ry0) return;
    qWash.append(svg("rect", {
      x: X(rx0), y: Y(ry1), width: X(rx1) - X(rx0), height: Y(ry0) - Y(ry1),
      fill: css(QUAD_COLOR[qName]), "fill-opacity": qName === quadrantOf(state.snap.blend.blended.x, state.snap.blend.blended.y) ? 0.055 : 0.025,
    }));
  };
  drawQRect(0, Infinity, 0, Infinity, "overheating");
  drawQRect(-Infinity, 0, 0, Infinity, "stagflation");
  drawQRect(0, Infinity, -Infinity, 0, "goldilocks");
  drawQRect(-Infinity, 0, -Infinity, 0, "slowdown");
  root.append(qWash);

  // Grid & dual-scale ticks
  const grid = svg("g");
  const thinX = W < 480 && step < 0.5;
  for (let v = Math.ceil(x0 / step - 1e-6) * step; v <= x1 + 1e-6; v += step) {
    const val = Number(v.toFixed(4));
    const isZero = Math.abs(val) < 1e-6;
    const isHalf = Math.abs((val * 2) % 1) < 1e-4;
    grid.append(svg("line", {
      x1: X(val), x2: X(val), y1: m.t, y2: H - m.b,
      stroke: isZero ? axisC : gridC, "stroke-width": isZero ? 1.5 : 0.8,
      "stroke-dasharray": isZero ? "4 3" : null,
    }));
    if (thinX && !isHalf) continue;
    const px = X(val);
    grid.append(svg("text", { x: px, y: H - m.b + 15, "text-anchor": "middle", "font-size": 11, "font-weight": isZero ? 700 : 500, fill: isZero ? ink2 : muted, text: cleanPctTick(trend, val) }));
    grid.append(svg("text", { x: px, y: H - m.b + 27, "text-anchor": "middle", "font-size": 9.8, fill: muted, text: isZero ? "trend" : `(${cleanGapTick(val)})` }));
  }

  for (let v = Math.ceil(y0 / step - 1e-6) * step; v <= y1 + 1e-6; v += step) {
    const val = Number(v.toFixed(4));
    const isZero = Math.abs(val) < 1e-6;
    grid.append(svg("line", {
      x1: m.l, x2: W - m.r, y1: Y(val), y2: Y(val),
      stroke: isZero ? axisC : gridC, "stroke-width": isZero ? 1.5 : 0.8,
      "stroke-dasharray": isZero ? "4 3" : null,
    }));
    const py = Y(val);
    grid.append(svg("text", { x: m.l - 8, y: py + 3.5, "text-anchor": "end", "font-size": 11, "font-weight": isZero ? 700 : 500, fill: isZero ? ink2 : muted, text: cleanPctTick(target, val) }));
  }

  // Axis titles
  grid.append(svg("text", { x: W - m.r, y: H - 6, "text-anchor": "end", "font-size": 11.5, "font-weight": 600, fill: ink2, text: `Expected Real GDP (${trend.toFixed(1)}% trend) →` }));
  grid.append(svg("text", { x: 14, y: (m.t + H - m.b) / 2, "text-anchor": "middle", "font-size": 11.5, "font-weight": 600, fill: ink2, transform: `rotate(-90 14 ${(m.t + H - m.b) / 2})`, text: `Expected Core PCE (${target.toFixed(1)}% target) →` }));

  // Quadrant watermarks (where inside view)
  const narrow = W < 540;
  const ql = (q, x, y, anchor) => grid.append(svg("text", {
    x, y, "text-anchor": anchor, "font-size": narrow ? 10 : 11, "font-weight": 700,
    fill: css(QUAD_COLOR[q]), "fill-opacity": 0.78, "letter-spacing": "0.06em",
    text: (narrow ? QUAD_SHORT[q] : QUAD_NAMES[q]).toUpperCase(),
  }));
  if (x0 < 0 && y1 > 0) ql("stagflation", m.l + 10, m.t + 15, "start");
  if (x1 > 0 && y1 > 0) ql("overheating", W - m.r - 10, m.t + 15, "end");
  if (x0 < 0 && y0 < 0) ql("slowdown", m.l + 10, H - m.b - 10, "start");
  if (x1 > 0 && y0 < 0) ql("goldilocks", W - m.r - 10, H - m.b - 10, "end");
  root.append(grid);

  // History trails (clipped) + interactive hover points
  const clipped = svg("g", { "clip-path": "url(#plot-clip)" });
  if (state.trail) {
    const tg = svg("g");
    const drawTrail = (arr, dash, w, labelPrefix) => {
      if (arr.length < 2) return;
      tg.append(svg("polyline", {
        points: arr.map((h) => `${X(h.x)},${Y(h.y)}`).join(" "),
        fill: "none", stroke: ink2, "stroke-width": w, "stroke-dasharray": dash, "stroke-linejoin": "round", opacity: 0.5,
      }));
      arr.forEach((h, i) => {
        const dot = svg("circle", {
          class: "trail-dot", cx: X(h.x), cy: Y(h.y), r: 3.2, fill: ink2, opacity: 0.25 + 0.55 * (i / arr.length),
        });
        dot.addEventListener("pointerenter", (e) => showTrailTip(h, labelPrefix, e));
        dot.addEventListener("pointermove", (e) => moveTip(e));
        dot.addEventListener("pointerleave", hoverOff);
        tg.append(dot);
      });
      // Label first visible & key turning point in full mode
      const first = arr[0];
      if (first.x >= x0 && first.x <= x1 && first.y >= y0 && first.y <= y1) {
        tg.append(svg("text", { x: X(first.x) + 5, y: Y(first.y) - 6, "font-size": 10, fill: muted, text: first.as_of.slice(0, 7) }));
      }
    };
    drawTrail(modelTrail, "3 3", 1.4, "Hard-data model");
    drawTrail(consTrail, null, 1.6, "Blended consensus");
    clipped.append(tg);
  }

  // Ellipses
  const eg = svg("g", { class: "ellipses" });
  const k = state.ciMode.endsWith("90") ? CI_K["90"] : CI_K["68"];
  for (const p of pts) {
    const c = colorOf(p);
    eg.append(svg("ellipse", {
      "data-key": p.key, "data-kind": p.kind,
      cx: X(p.x), cy: Y(p.y), rx: sxPx(p.sx * k), ry: syPx(p.sy * k),
      fill: p.stale ? "none" : c, stroke: c,
      "stroke-dasharray": p.stale ? "4 3" : p.kind === "model" ? "6 3" : null,
    }));
  }
  clipped.append(eg);

  // Direction arrows
  if (state.arrows) {
    const defs = svg("defs");
    const ag = svg("g", { class: "arrows" });
    const len = state.zoom === "cluster" ? 0.24 : 0.42;
    for (const p of pts) {
      if (!p.dx && !p.dy) continue;
      const c = colorOf(p);
      const id = `ah-${p.key}`;
      defs.append(svg("marker", { id, viewBox: "0 0 8 8", refX: 6, refY: 4, markerWidth: 6.5, markerHeight: 6.5, orient: "auto-start-reverse" },
        svg("path", { d: "M0,0.8L7,4L0,7.2z", fill: c })));
      ag.append(svg("line", {
        "data-key": p.key,
        x1: X(p.x), y1: Y(p.y), x2: X(p.x + p.dx * len), y2: Y(p.y + p.dy * len),
        stroke: c, "stroke-width": 1.5, "marker-end": `url(#${id})`, opacity: p.stale ? 0.38 : 0.8,
      }));
    }
    root.append(defs);
    clipped.append(ag);
  }
  root.append(clipped);

  // Markers
  const mg = svg("g");
  const placed = [];
  const nodes = [];
  for (const p of pts) {
    const c = colorOf(p);
    const g = svg("g", {
      class: "pt", "data-key": p.key, transform: `translate(${X(p.x)},${Y(p.y)})`,
      tabindex: 0, role: "button",
      "aria-label": `${p.name}: GDP ${fmtLevel(p.x, trend)}, Core PCE ${fmtLevel(p.y, target)}`,
    });
    g.append(svg("circle", { class: "hit", r: 14, fill: "transparent" }));
    g.append(svg("circle", { class: "sel-ring", r: 11.5, fill: "none", stroke: css("--focus"), "stroke-width": 2, "stroke-dasharray": "3 2", display: "none" }));
    if (p.kind === "consensus") {
      g.append(svg("circle", { r: 8.5, fill: surface, "fill-opacity": 0.85, stroke: c, "stroke-width": 2.8 }));
      g.append(svg("circle", { r: 2.8, fill: c }));
    } else {
      const r = p.kind === "model" ? 6.5 : 5.5;
      g.append(svg("path", {
        d: markerPath(p.type, r),
        fill: p.stale ? surface : c,
        stroke: p.stale ? c : surface,
        "stroke-width": 2, "paint-order": "stroke",
      }));
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

  // Direct labels (consensus & model first, then fresh views, then stale views)
  const lg = svg("g", { "pointer-events": "none" });
  root.append(lg);
  host.replaceChildren(root);

  const rank = (p) => (p.kind === "consensus" ? 0 : p.kind === "model" ? 1 : p.stale ? 3 : 2);
  const order = [...nodes].sort((a, b) => rank(a) - rank(b));
  for (const p of order) {
    const px = X(p.x), py = Y(p.y);
    const labelText = p.stale ? `${p.label} (stale)` : p.label;
    const t = svg("text", {
      "font-size": p.kind === "view" ? 11 : 12,
      "font-weight": p.kind === "view" ? (p.stale ? 500 : 620) : 730,
      fill: p.kind === "consensus" ? css("--consensus") : p.kind === "model" ? css("--ink") : p.stale ? muted : ink2,
      stroke: surface, "stroke-width": 3.5, "paint-order": "stroke", "stroke-linejoin": "round",
      text: labelText,
    });
    lg.append(t);
    const bw = t.getComputedTextLength() + 3, bh = 13;
    const cands = [
      [10, 4, "start"], [-10, 4, "end"], [0, -12, "middle"], [0, 20, "middle"],
      [10, -10, "start"], [-10, -10, "end"], [10, 17, "start"], [-10, 17, "end"],
      [16, 4, "start"], [-16, 4, "end"], [0, -21, "middle"], [0, 28, "middle"],
    ];
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
    t.setAttribute("x", px + best.ox);
    t.setAttribute("y", py + best.oy);
    t.setAttribute("text-anchor", best.anchor);
    t.setAttribute("data-key", p.key);
    placed.push(best.box);
  }

  // Minimap when zoomed into a cluster that crops out quadrants
  const cropsQuadrants = x0 > -0.6 || y0 > -0.4;
  if (state.zoom === "cluster" && cropsQuadrants) {
    const mm = el("button", {
      type: "button", class: "minimap",
      title: "Click to show all 4 quadrants",
      onclick: () => setZoom("full"),
    },
      el("div", { class: "minimap-title", text: "Full 4 quadrants ↗" }),
      svg("svg", { viewBox: "-1.6 -1.8 3.6 3.6", "aria-hidden": "true" },
        svg("line", { x1: -1.6, x2: 2.0, y1: 0, y2: 0, stroke: axisC, "stroke-width": 0.08 }),
        svg("line", { x1: 0, x2: 0, y1: -1.8, y2: 1.8, stroke: axisC, "stroke-width": 0.08 }),
        svg("rect", {
          x: x0, y: -y1, width: x1 - x0, height: y1 - y0,
          fill: css("--consensus"), "fill-opacity": 0.14, stroke: css("--consensus"), "stroke-width": 0.09,
        }),
        ...pts.map((p) => svg("circle", { cx: p.x, cy: -p.y, r: 0.09, fill: colorOf(p) })),
      ));
    host.append(mm);
  }

  applyFocus();
}

function applyFocus() {
  const focus = state.hover || state.selected;
  const mode = state.ciMode;
  for (const e of document.querySelectorAll(".chart ellipse")) {
    const key = e.dataset.key, strong = key === focus;
    let show = false;
    if (mode === "off") show = false;
    else if (mode.startsWith("focus")) show = strong;
    else show = true;
    e.style.display = show ? "" : "none";
    e.setAttribute("fill-opacity", strong ? 0.12 : 0.03);
    e.setAttribute("stroke-opacity", strong ? 0.9 : 0.35);
    e.setAttribute("stroke-width", strong ? 1.6 : 1);
  }
  for (const ring of document.querySelectorAll(".chart .sel-ring")) {
    const key = ring.parentElement?.dataset?.key;
    ring.style.display = key === state.selected ? "" : "none";
  }
  for (const n of document.querySelectorAll(".chart .pt, .chart text[data-key], .chart .arrows line")) {
    n.classList.toggle("dim", Boolean(state.hover) && n.dataset.key !== state.hover);
  }
}

function trailSeries() {
  const s = state.snap;
  const byDate = new Map();
  for (const h of s.model.history || []) byDate.set(h.as_of, { as_of: h.as_of, x: h.x, y: h.y });
  for (const h of state.history) if (h.model && h.as_of <= s.as_of) byDate.set(h.as_of, { as_of: h.as_of, x: h.model.x, y: h.model.y });
  byDate.set(s.as_of, { as_of: s.as_of, x: s.model.point.x, y: s.model.point.y });
  const model = [...byDate.values()].sort((a, b) => a.as_of.localeCompare(b.as_of)).slice(-18);
  const cons = state.history
    .filter((h) => h.consensus && !h.backfill && h.as_of <= s.as_of)
    .map((h) => ({ as_of: h.as_of, x: h.consensus.x, y: h.consensus.y }));
  if (!cons.some((c) => c.as_of === s.as_of)) cons.push({ as_of: s.as_of, x: s.blend.blended.x, y: s.blend.blended.y });
  return [model, cons.slice(-26)];
}

// ------------------------------------------------------------------ tooltip

function showTrailTip(h, labelPrefix, e) {
  const tip = document.getElementById("tooltip");
  const trend = trendBase(), target = targetBase();
  tip.replaceChildren(
    el("div", { class: "v", text: `GDP ${fmtLevel(h.x, trend)} (${fmt(h.x)}) · PCE ${fmtLevel(h.y, target)} (${fmt(h.y)})` }),
    el("div", { class: "n", text: `${labelPrefix} · ${h.as_of}` }),
    el("div", { class: "m", text: QUAD_NAMES[quadrantOf(h.x, h.y)] }),
  );
  tip.hidden = false;
  moveTip(e);
}

function hoverOn(p, e, node) {
  state.hover = p.key;
  const tip = document.getElementById("tooltip");
  const trend = trendBase(), target = targetBase();
  const extra = p.kind === "view"
    ? `${p.src.published || "n.d."}${p.stale ? " · stale" : ""} · ${QUAD_SHORT[quadrantOf(p.x, p.y)]}`
    : p.kind === "model"
    ? `${state.snap.model.indicators.length} FRED indicators · ${QUAD_SHORT[quadrantOf(p.x, p.y)]}`
    : `40% hard data + 60% houses · ${QUAD_SHORT[quadrantOf(p.x, p.y)]}`;
  tip.replaceChildren(
    el("div", { class: "v", text: `GDP ${fmtLevel(p.x, trend)} (${fmt(p.x)}) · PCE ${fmtLevel(p.y, target)} (${fmt(p.y)})` }),
    el("div", { class: "n" }, el("span", { class: "key", style: `background:${colorOf(p)}` }), p.name),
    el("div", { class: "m", text: `1σ: ±${p.sx.toFixed(2)} / ±${p.sy.toFixed(2)} pp · ${extra}` }),
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
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}

function hoverOff() {
  state.hover = null;
  document.getElementById("tooltip").hidden = true;
  applyFocus();
}

// ------------------------------------------------------------------ detail inspector

function select(key) {
  state.selected = key;
  renderDetail();
  applyFocus();
  for (const tr of document.querySelectorAll("#views-table tbody tr.view-row")) {
    tr.classList.toggle("sel", tr.dataset.id === key);
  }
}

function coordsBlock(x, sx, y, sy, vsCons = false) {
  const trend = trendBase(), target = targetBase();
  const b = state.snap.blend.blended;
  const gSub = vsCons ? `${fmt(x)}pp (${fmt(x - b.x)} vs cons.)` : `${fmt(x)}pp · ±${sx.toFixed(2)} (1σ)`;
  const pSub = vsCons ? `${fmt(y)}pp (${fmt(y - b.y)} vs cons.)` : `${fmt(y)}pp · ±${sy.toFixed(2)} (1σ)`;
  return el("div", { class: "coords" },
    el("div", {}, el("div", { class: "l", text: "Implied Real GDP" }), el("div", { class: "v", text: fmtLevel(x, trend) }), el("div", { class: "s", text: gSub })),
    el("div", {}, el("div", { class: "l", text: "Implied Core PCE" }), el("div", { class: "v", text: fmtLevel(y, target) }), el("div", { class: "s", text: pSub })),
  );
}

function renderDetail() {
  const box = document.getElementById("detail");
  const s = state.snap;
  const trend = trendBase(), target = targetBase();
  const key = state.selected;
  const parts = [];

  if (key === "consensus") {
    const b = s.blend.blended;
    const { prose } = computeTensionInsights(s);
    const topHouse = [...s.views].sort((a, b) => (b.weight || 0) - (a.weight || 0))[0];
    parts.push(
      el("div", { class: "detail-head" },
        el("h3", { text: "Blended consensus" }),
        el("span", { class: "chip", text: `${pct(s.blend.model_weight_share)} data weight` })),
      el("div", { class: "meta" },
        el("span", { class: "chip", text: QUAD_NAMES[quadrantOf(b.x, b.y)] })),
      coordsBlock(b.x, b.sx, b.y, b.sy, false),
      el("p", { text: prose }),
      el("h4", { text: "Houses vs Hard Data" }),
      el("table", { class: "nums" }, el("tbody", {},
        el("tr", {}, el("td", { text: "Houses (mixture)" }), el("td", { text: `${fmtLevel(s.blend.houses.x, trend)} / ${fmtLevel(s.blend.houses.y, target)}` }), el("td", { text: `${fmt(s.blend.houses.x)} / ${fmt(s.blend.houses.y)}` })),
        el("tr", {}, el("td", { text: "Hard-data model" }), el("td", { text: `${fmtLevel(s.model.point.x, trend)} / ${fmtLevel(s.model.point.y, target)}` }), el("td", { text: `${fmt(s.model.point.x)} / ${fmt(s.model.point.y)}` })),
      )),
      el("div", { class: "detail-actions" },
        el("button", { type: "button", text: "Inspect Hard Data", onclick: () => select("data_model") }),
        topHouse ? el("button", { type: "button", text: `Top view (${topHouse.short || topHouse.name})`, onclick: () => select(topHouse.id) }) : null,
      ),
    );
  } else if (key === "data_model") {
    const p = s.model.point;
    const top = [...s.model.indicators].sort((a, b) => Math.abs(b.gap * b.weight) - Math.abs(a.gap * a.weight)).slice(0, 5);
    parts.push(
      el("div", { class: "detail-head" },
        el("h3", { text: "Hard-data model (FRED)" }),
        el("button", { type: "button", class: "link-btn small", text: "← Consensus", onclick: () => select("consensus") })),
      el("div", { class: "meta" },
        el("span", { class: "chip", text: QUAD_SHORT[p.quadrant] }),
        el("span", { class: "chip", text: `${s.model.indicators.length} indicators` })),
      coordsBlock(p.x, p.sx, p.y, p.sy, false),
      el("p", { class: "small muted", text: `3-month momentum: Growth ${fmt(p.dx)}pp, Core PCE ${fmt(p.dy)}pp.` }),
      el("h4", { text: "Biggest weighted drivers" }),
      el("table", { class: "nums" }, el("tbody", {}, top.map((r) =>
        el("tr", {}, el("td", { text: r.label }), el("td", { text: `${fmt(r.gap)}pp` }), el("td", { text: r.axis }))))),
      el("p", { class: "small muted", text: s.model.caveat || "" }),
    );
  } else {
    const v = s.views.find((x) => x.id === key);
    if (!v) { state.selected = "consensus"; return renderDetail(); }
    const url = safeUrl(v.url);
    const col = css(TYPE_VAR[v.type] || "--ink");
    parts.push(
      el("div", { class: "detail-head" },
        el("h3", { text: v.name }),
        el("button", { type: "button", class: "link-btn small", text: "← Consensus", onclick: () => select("consensus") })),
      el("div", { class: "meta" },
        el("span", { class: "chip" }, el("span", { class: "key", style: `background:${col}` }), TYPE_SHORT[v.type] || v.type),
        el("span", { class: `chip${v.stale ? " stale" : ""}`, text: `${v.published || "n.d."}${v.age_days != null ? ` · ${v.age_days}d` : ""}${v.stale ? " · stale" : ""}` }),
        el("span", { class: "chip", text: `Weight ${v.weight ?? "?"} (${v.confidence})` })),
      url ? el("p", { class: "small" }, el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: `${v.title || url} ↗` })) : el("p", { class: "small", text: v.title || "" }),
      coordsBlock(v.x, v.sx, v.y, v.sy, true),
      el("p", { class: "small", text: v.summary }),
      v.forecast_numbers?.length ? [
        el("h4", { text: "Explicit forecasts" }),
        el("table", { class: "nums" }, el("tbody", {}, v.forecast_numbers.map((f) => el("tr", {}, el("td", { text: f.metric }), el("td", { text: f.value }), el("td", { text: f.period }))))),
      ] : null,
      v.key_points?.length ? [
        el("h4", { text: "Key points" }),
        el("ul", { class: "bullets" }, v.key_points.map((k) => el("li", { text: k }))),
      ] : null,
      v.quotes?.length ? [
        el("h4", { text: "In their words" }),
        ...v.quotes.map((q) => el("blockquote", { text: `“${q}”` })),
      ] : null,
      el("details", { class: "audit-details" },
        el("summary", { text: `Scoring audit (1σ ±${v.sx.toFixed(2)}/±${v.sy.toFixed(2)}pp · + click)` }),
        el("p", { class: "rationale", text: `${v.scoring_rationale || ""} (${v.method || "?"})` })),
    );
  }
  box.replaceChildren(...parts.flat(Infinity).filter(Boolean));
}

// ------------------------------------------------------------------ hard-data drivers

function renderIndicators() {
  const s = state.snap, syn = s.synthesis || {};
  const trend = trendBase(), target = targetBase();
  const m = s.model.point;

  document.getElementById("data-supports").textContent = syn.data_supports ||
    `Hard data place the economy at ${fmtLevel(m.x, trend)} GDP (${fmt(m.x)}pp) and ${fmtLevel(m.y, target)} core PCE (${fmt(m.y)}pp).`;

  const grid = document.getElementById("indicators-grid");
  const minG = -2.0, maxG = 2.5, span = maxG - minG;
  const zeroPct = ((0 - minG) / span) * 100;

  const cols = [
    {
      axis: "growth",
      title: `Growth drivers (${s.model.indicators.filter((i) => i.axis === "growth").length})`,
      sub: `Model implied GDP: ${fmtLevel(m.x, trend)} (${fmt(m.x)}pp)`,
      baseColor: css("--q-goldilocks"),
    },
    {
      axis: "inflation",
      title: `Inflation drivers (${s.model.indicators.filter((i) => i.axis === "inflation").length})`,
      sub: `Model implied Core PCE: ${fmtLevel(m.y, target)} (${fmt(m.y)}pp)`,
      baseColor: css("--q-overheating"),
    },
  ];

  grid.replaceChildren(...cols.map((col) => {
    const rows = s.model.indicators
      .filter((i) => i.axis === col.axis)
      .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
    const hotN = rows.filter((r) => r.gap > 0.25).length;
    const neuN = rows.filter((r) => Math.abs(r.gap) <= 0.25).length;
    const coolN = rows.filter((r) => r.gap < -0.25).length;

    return el("div", {},
      el("div", { class: "ind-col-head" },
        el("div", {},
          el("div", { class: "ind-col-title", text: col.title }),
          el("div", { class: "ind-col-sub", text: col.sub }),
        ),
        el("span", { class: "chip", text: `${hotN} hot · ${neuN} neutral · ${coolN} cool` }),
      ),
      el("div", { class: "ind-scale" },
        el("span", { text: "−2.0pp (Cool)" }),
        el("span", { text: "0 (Baseline)" }),
        el("span", { text: "+2.5pp (Hot)" }),
      ),
      ...rows.map((r) => {
        const clamped = Math.max(minG, Math.min(maxG, r.gap));
        const pVal = ((clamped - minG) / span) * 100;
        const left = clamped >= 0 ? zeroPct : pVal;
        const width = Math.max(1.5, Math.abs(pVal - zeroPct));
        const isWeak = Math.abs(r.gap) < 0.25;
        const fillCol = isWeak ? css("--muted") : r.gap > 0 ? col.baseColor : css("--q-slowdown");
        const valUnit = r.unit === "%" ? "%" : r.unit === "k" ? "k" : r.unit === "pp" ? "pp" : "";
        const formattedVal = `${r.unit === "k" && r.value > 0 ? "+" : ""}${r.unit === "k" ? Math.round(r.value) : r.value.toFixed(2)}${valUnit}`;
        const cat = IND_CATEGORY[r.id] || r.axis;

        return el("div", { class: "ind-row", title: r.note },
          el("div", {},
            el("div", { class: "ind-name", text: r.label }),
            el("div", { class: "ind-meta", text: `${cat} · ${r.observation_date || ""} · ${r.weight}× weight` }),
            state.showRules && r.note ? el("div", { class: "ind-rule", text: r.note }) : null,
          ),
          el("div", { class: "ind-val", text: formattedVal }),
          el("div", { class: "gapbar" },
            el("div", { class: "track", "aria-hidden": "true" },
              el("span", { class: "fill", style: `left:${left}%;width:${width}%;background:${fillCol}` }))),
          el("div", { class: `ind-gap${isWeak ? " weak" : ""}`, text: `${fmt(r.gap, 2)}pp` }),
        );
      }),
    );
  }));
}

// ------------------------------------------------------------------ views table + inline expand

function renderViewFilters() {
  const views = state.snap.views;
  const counts = {
    all: views.length,
    fresh: views.filter((v) => !v.stale).length,
    buy_side: views.filter((v) => v.type === "buy_side").length,
    sell_side: views.filter((v) => v.type === "sell_side").length,
    official: views.filter((v) => v.type === "official").length,
    stale: views.filter((v) => v.stale).length,
  };
  const defs = [
    ["all", `All (${counts.all})`],
    ["fresh", `Fresh (${counts.fresh})`],
    ["buy_side", `Buy-side (${counts.buy_side})`],
    ["sell_side", `Sell-side (${counts.sell_side})`],
    ["official", `Official (${counts.official})`],
    ["stale", `Stale (${counts.stale})`],
  ].filter(([k]) => k === "all" || counts[k] > 0);

  if (!defs.some(([k]) => k === state.filter)) state.filter = "all";

  document.getElementById("view-filters").replaceChildren(...defs.map(([k, label]) =>
    el("button", {
      type: "button", role: "tab", "aria-selected": String(state.filter === k),
      "aria-checked": String(state.filter === k),
      text: label,
      onclick: () => { state.filter = k; renderViewFilters(); renderViewsTable(); },
    })
  ));
}

function renderViewsTable() {
  const s = state.snap;
  const trend = trendBase(), target = targetBase();
  const presentIds = new Set(s.views.map((v) => v.id));
  const missing = (s.sources || []).filter((src) => !presentIds.has(src.id)).map((src) => src.name);
  document.getElementById("coverage-note").textContent = missing.length
    ? `Showing ${s.views.length} of ${s.sources.length} tracked institutions (missing: ${missing.join(", ")}). Click any row to highlight & expand.`
    : `Showing all ${s.views.length} tracked institutions. Click any row to highlight & expand.`;

  let list = [...s.views];
  if (state.filter === "fresh") list = list.filter((v) => !v.stale);
  else if (state.filter === "stale") list = list.filter((v) => v.stale);
  else if (state.filter !== "all") list = list.filter((v) => v.type === state.filter);

  list.sort((a, b) => {
    if (state.sort === "weight") return (b.weight || 0) - (a.weight || 0) || b.y - a.y;
    if (state.sort === "inflation") return b.y - a.y;
    if (state.sort === "growth") return b.x - a.x;
    if (state.sort === "growth_asc") return a.x - b.x;
    return (b.published || "").localeCompare(a.published || "");
  });

  const rows = [];
  for (const v of list) {
    const color = css(TYPE_VAR[v.type] || "--ink");
    const icon = svg("svg", { class: "shape", width: 12, height: 12, viewBox: "-6 -6 12 12", "aria-hidden": "true" },
      svg("path", { d: markerPath(v.type, 4.5), fill: v.stale ? "none" : color, stroke: color, "stroke-width": 1.6 }));
    const badge = policyBadge(v);
    const isSel = v.id === state.selected;
    const isExp = v.id === state.expandedRow;

    rows.push(el("tr", {
      class: `view-row${isSel ? " sel" : ""}`,
      "data-id": v.id,
      tabindex: 0,
      "aria-expanded": String(isExp),
      onclick: () => {
        state.expandedRow = isExp ? null : v.id;
        select(v.id);
        renderViewsTable();
      },
      onkeydown: (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          state.expandedRow = isExp ? null : v.id;
          select(v.id);
          renderViewsTable();
        }
      },
    },
      el("td", {},
        el("div", { class: "inst-cell" }, icon,
          el("div", {},
            el("div", { class: "inst-name", text: v.name }),
            el("div", { class: "inst-sub", text: `${TYPE_SHORT[v.type] || v.type}${badge ? ` · ${badge}` : ""}` }),
          ))),
      el("td", {},
        el("div", { class: v.stale ? "stale-tag" : "", text: v.published || "n.d." }),
        el("div", { class: "val-sub", text: `${v.age_days != null ? `${v.age_days}d ago` : ""}${v.stale ? " · stale" : ` · w=${v.weight}`}` })),
      el("td", { class: "num" },
        el("div", { class: "val-main", text: fmtLevel(v.x, trend) }),
        el("div", { class: "val-sub", text: `${fmt(v.x)} ±${v.sx.toFixed(1)}` })),
      el("td", { class: "num" },
        el("div", { class: "val-main", text: fmtLevel(v.y, target) }),
        el("div", { class: "val-sub", text: `${fmt(v.y)} ±${v.sy.toFixed(1)}` })),
      el("td", { class: "muted small", text: dirWord(v.dx || 0, v.dy || 0) }),
      el("td", { class: "summary-cell", text: v.summary || "" }),
    ));

    if (isExp) {
      const url = safeUrl(v.url);
      rows.push(el("tr", { class: "row-expand" },
        el("td", { colspan: 6 },
          el("div", { class: "expand-head" },
            url ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", class: "small", text: `${v.title || url} ↗` })
              : el("span", { class: "small", text: v.title || "" }),
            el("button", {
              type: "button", class: "link-btn small", text: "Focus on chart ↑",
              onclick: (e) => {
                e.stopPropagation();
                select(v.id);
                document.getElementById("chart-workspace").scrollIntoView({ behavior: "smooth", block: "start" });
              },
            }),
          ),
          el("div", { class: "expand-grid" },
            el("div", {},
              el("h4", { text: "Key points" }),
              v.key_points?.length ? el("ul", { class: "bullets" }, v.key_points.map((k) => el("li", { text: k })))
                : el("p", { class: "muted small", text: "No bullet summary recorded." }),
            ),
            el("div", {},
              el("h4", { text: "Explicit forecasts" }),
              v.forecast_numbers?.length ? el("table", { class: "nums" }, el("tbody", {}, v.forecast_numbers.map((f) =>
                el("tr", {}, el("td", { text: f.metric }), el("td", { text: f.value }), el("td", { text: f.period })))))
                : el("p", { class: "muted small", text: "Qualitative commentary only." }),
            ),
            el("div", {},
              el("h4", { text: "Quotes & scoring audit" }),
              ...(v.quotes || []).slice(0, 2).map((q) => el("blockquote", { text: `“${q}”` })),
              el("p", { class: "muted small", text: `${v.scoring_rationale || ""} (${v.method || "?"})` }),
            ),
          ),
        ),
      ));
    }
  }

  document.querySelector("#views-table tbody").replaceChildren(...rows);
}

// ------------------------------------------------------------------ controls

function setZoom(mode) {
  state.zoom = mode;
  for (const b of document.querySelectorAll("#zoom-mode button")) {
    b.setAttribute("aria-checked", String(b.dataset.zoom === mode));
  }
  renderChart();
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
    if (v === "model") state.selected = "data_model";
    else if (v === "blended" && state.selected === "data_model") state.selected = "consensus";
    renderHero();
    renderDetail();
    applyFocus();
  });

  bindSeg("zoom-mode", "zoom", (v) => setZoom(v));

  document.getElementById("opt-ci").addEventListener("change", (e) => {
    state.ciMode = e.target.value;
    renderChart();
  });

  const chk = (id, key, fn) => document.getElementById(id).addEventListener("change", (e) => {
    state[key] = e.target.checked;
    fn();
  });
  chk("opt-arrows", "arrows", renderChart);
  chk("opt-trail", "trail", () => { renderLegend(); renderChart(); });
  chk("opt-stale", "showStale", renderChart);
  chk("opt-rules", "showRules", renderIndicators);

  document.getElementById("view-sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    renderViewsTable();
  });

  document.getElementById("snapshot-select").addEventListener("change", (e) => {
    loadSnapshotDate(e.target.value).catch((err) => showBanner(err));
  });
  document.getElementById("back-latest").addEventListener("click", () => {
    if (state.latestDate) loadSnapshotDate(state.latestDate).catch((err) => showBanner(err));
  });

  let t = 0;
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(renderChart, 120); });

  const saved = store.get("giq-theme");
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
  const syncThemeLabel = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.getElementById("theme-toggle").textContent = cur === "dark" ? "Light mode" : "Dark mode";
  };
  syncThemeLabel();

  document.getElementById("theme-toggle").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("giq-theme", next);
    syncThemeLabel();
    renderAll();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    syncThemeLabel();
    renderAll();
  });
}

function showBanner(err) {
  const banner = document.getElementById("banner");
  banner.hidden = false;
  banner.replaceChildren(
    el("b", { text: "Could not load data. " }),
    `${err.message}. Check apiBase in config.js (currently "${apiBase() || "same origin"}").`,
  );
}

function renderAll() {
  if (!state.snap) return;
  document.getElementById("banner").hidden = true;
  renderChrome();
  renderHero();
  renderLegend();
  renderChart();
  renderDetail();
  renderIndicators();
  renderViewFilters();
  renderViewsTable();
}

async function main() {
  bindControls();
  try {
    await loadInitial();
    renderAll();
  } catch (err) {
    showBanner(err);
    document.getElementById("baselines-sub").textContent = "No data";
  }
}

main();
