// Unified quadrant-constrained confidence region math (single truncated normals + mixture HDR).

export const ALL_QUADRANTS = ["goldilocks", "overheating", "stagflation", "slowdown"];

export function quadrantOf(x, y) {
  return x >= 0 ? (y >= 0 ? "overheating" : "goldilocks") : (y >= 0 ? "stagflation" : "slowdown");
}

export function allowedQuadrants(point) {
  const base = quadrantOf(point.x, point.y);
  const raw = Array.isArray(point.plausible_quadrants) ? point.plausible_quadrants : [];
  const set = new Set(raw.filter((q) => ALL_QUADRANTS.includes(q)));
  set.add(base);
  return set;
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}

export function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export function componentNormMass(c, allowed) {
  if (allowed.size >= 4) return 1;
  const pxPos = 1 - normalCdf(-c.x / c.sx);
  const pxNeg = 1 - pxPos;
  const pyPos = 1 - normalCdf(-c.y / c.sy);
  const pyNeg = 1 - pyPos;
  let sum = 0;
  if (allowed.has("overheating")) sum += pxPos * pyPos;
  if (allowed.has("goldilocks")) sum += pxPos * pyNeg;
  if (allowed.has("stagflation")) sum += pxNeg * pyPos;
  if (allowed.has("slowdown")) sum += pxNeg * pyNeg;
  return Math.max(sum, 1e-6);
}

// Calibrated Mahalanobis radius r_p so that P(d^2 <= r_p^2 | Q) = pLevel.
export function calibrateTruncatedRadius(x, sx, y, sy, allowed, pLevel) {
  if (allowed.size >= 4) return Math.sqrt(-2 * Math.log(1 - pLevel));
  const n = 56;
  const span = 4.2;
  const x0 = x - span * sx, x1 = x + span * sx;
  const y0 = y - span * sy, y1 = y + span * sy;
  const dx = (x1 - x0) / n, dy = (y1 - y0) / n;
  const pts = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const ux = x0 + (i + 0.5) * dx;
    const zx = (ux - x) / sx;
    for (let j = 0; j < n; j++) {
      const vy = y0 + (j + 0.5) * dy;
      if (!allowed.has(quadrantOf(ux, vy))) continue;
      const zy = (vy - y) / sy;
      const r2 = zx * zx + zy * zy;
      const w = Math.exp(-0.5 * r2);
      pts.push([r2, w]);
      total += w;
    }
  }
  if (!pts.length || total <= 0) return Math.sqrt(-2 * Math.log(1 - pLevel));
  pts.sort((a, b) => a[0] - b[0]);
  let acc = 0;
  for (const [r2, w] of pts) {
    acc += w / total;
    if (acc >= pLevel) return Math.sqrt(r2);
  }
  return span;
}

// Sutherland-Hodgman clip of polygon [[x, y], ...] against linear half-plane.
function clipHalfPlane(poly, inside, intersect) {
  if (!poly.length) return [];
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ia = inside(a), ib = inside(b);
    if (ia && ib) {
      out.push(b);
    } else if (ia && !ib) {
      out.push(intersect(a, b));
    } else if (!ia && ib) {
      out.push(intersect(a, b), b);
    }
  }
  return out;
}

const clipXMin = (poly, x0 = 0) => clipHalfPlane(poly, (p) => p[0] >= x0, (a, b) => {
  const t = (x0 - a[0]) / (b[0] - a[0] || 1e-12);
  return [x0, a[1] + t * (b[1] - a[1])];
});
const clipXMax = (poly, x0 = 0) => clipHalfPlane(poly, (p) => p[0] <= x0, (a, b) => {
  const t = (x0 - a[0]) / (b[0] - a[0] || 1e-12);
  return [x0, a[1] + t * (b[1] - a[1])];
});
const clipYMin = (poly, y0 = 0) => clipHalfPlane(poly, (p) => p[1] >= y0, (a, b) => {
  const t = (y0 - a[1]) / (b[1] - a[1] || 1e-12);
  return [a[0] + t * (b[0] - a[0]), y0];
});
const clipYMax = (poly, y0 = 0) => clipHalfPlane(poly, (p) => p[1] <= y0, (a, b) => {
  const t = (y0 - a[1]) / (b[1] - a[1] || 1e-12);
  return [a[0] + t * (b[0] - a[0]), y0];
});

function clipSingleQuadrant(poly, q) {
  if (q === "overheating") return clipYMin(clipXMin(poly, 0), 0);
  if (q === "goldilocks") return clipYMax(clipXMin(poly, 0), 0);
  if (q === "stagflation") return clipYMin(clipXMax(poly, 0), 0);
  return clipYMax(clipXMax(poly, 0), 0);
}

// Split polygon edges at x=0 and y=0, then excise the single forbidden quadrant strictly.
function clipOutSingleQuadrant(poly, forbidQ) {
  if (!poly.length) return [];
  const xNeg = forbidQ === "stagflation" || forbidQ === "slowdown";
  const yNeg = forbidQ === "goldilocks" || forbidQ === "slowdown";
  const inForbidStrict = ([x, y]) => (xNeg ? x < -1e-9 : x > 1e-9) && (yNeg ? y < -1e-9 : y > 1e-9);
  const splitAtAxis = (pts, axisIdx) => {
    const res = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      res.push(a);
      if ((a[axisIdx] < -1e-9 && b[axisIdx] > 1e-9) || (a[axisIdx] > 1e-9 && b[axisIdx] < -1e-9)) {
        const t = -a[axisIdx] / (b[axisIdx] - a[axisIdx]);
        const hit = axisIdx === 0 ? [0, a[1] + t * (b[1] - a[1])] : [a[0] + t * (b[0] - a[0]), 0];
        res.push(hit);
      }
    }
    return res;
  };
  const denseRaw = splitAtAxis(splitAtAxis(poly, 0), 1);
  const dense = [];
  for (let i = 0; i < denseRaw.length; i++) {
    const a = denseRaw[i], b = denseRaw[(i + 1) % denseRaw.length];
    dense.push(a);
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (!inForbidStrict(a) && !inForbidStrict(b) && inForbidStrict(mid)) dense.push(mid);
  }
  if (!dense.some(inForbidStrict)) return [poly];
  const out = [];
  let droppedStart = null;
  let lastValid = null;
  const n = dense.length;
  const firstOutside = dense.findIndex((p) => !inForbidStrict(p));
  if (firstOutside < 0) return [];
  for (let k = 0; k <= n; k++) {
    const p = dense[(firstOutside + k) % n];
    if (inForbidStrict(p)) {
      if (droppedStart === null) droppedStart = lastValid;
    } else {
      if (droppedStart !== null) {
        const onX0 = Math.abs(droppedStart[0]) < 1e-7;
        const onY0 = Math.abs(droppedStart[1]) < 1e-7;
        const nowX0 = Math.abs(p[0]) < 1e-7;
        const nowY0 = Math.abs(p[1]) < 1e-7;
        if ((onX0 && nowY0) || (onY0 && nowX0)) out.push([0, 0]);
        droppedStart = null;
      }
      if (k < n) out.push(p);
      lastValid = p;
    }
  }
  return out.length >= 3 ? [out] : [];
}

export function clipPolygonToQuadrants(poly, allowed) {
  if (poly.length < 3) return [];
  if (allowed.size >= 4) return [poly];
  if (allowed.size === 1) {
    const [q] = allowed;
    const res = clipSingleQuadrant(poly, q);
    return res.length >= 3 ? [res] : [];
  }
  if (allowed.size === 2) {
    const hasO = allowed.has("overheating"), hasG = allowed.has("goldilocks");
    const hasS = allowed.has("stagflation"), hasD = allowed.has("slowdown");
    if (hasO && hasS) { const r = clipYMin(poly, 0); return r.length >= 3 ? [r] : []; }
    if (hasG && hasD) { const r = clipYMax(poly, 0); return r.length >= 3 ? [r] : []; }
    if (hasO && hasG) { const r = clipXMin(poly, 0); return r.length >= 3 ? [r] : []; }
    if (hasS && hasD) { const r = clipXMax(poly, 0); return r.length >= 3 ? [r] : []; }
    return [...allowed].map((q) => clipSingleQuadrant(poly, q)).filter((r) => r.length >= 3);
  }
  const forbid = ALL_QUADRANTS.find((q) => !allowed.has(q));
  return clipOutSingleQuadrant(poly, forbid);
}

export function singleComponentPolygons(point, pLevel, steps = 112) {
  const allowed = allowedQuadrants(point);
  const r = calibrateTruncatedRadius(point.x, point.sx, point.y, point.sy, allowed, pLevel);
  const rx = point.sx * r, ry = point.sy * r;
  const poly = [];
  for (let i = 0; i < steps; i++) {
    const a = (2 * Math.PI * i) / steps;
    poly.push([point.x + rx * Math.cos(a), point.y + ry * Math.sin(a)]);
  }
  return { polygons: clipPolygonToQuadrants(poly, allowed), radius: r, allowed };
}

// Compute exact Highest Density Region contour(s) for a mixture of Q-truncated bivariate normals.
export function mixtureHdrPolygons(components, pLevel, gridN = 88) {
  const comps = components.filter((c) => c.w > 0);
  if (!comps.length) return { polygons: [], allowed: new Set() };
  const wsum = comps.reduce((s, c) => s + c.w, 0);
  const unionAllowed = new Set();
  const prep = comps.map((c) => {
    const allowed = allowedQuadrants(c);
    for (const q of allowed) unionAllowed.add(q);
    const Z = componentNormMass(c, allowed);
    const norm = (c.w / wsum) / (Z * 2 * Math.PI * c.sx * c.sy);
    return { ...c, allowed, norm };
  });

  if (prep.length === 1) {
    return singleComponentPolygons(prep[0], pLevel);
  }

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const c of prep) {
    x0 = Math.min(x0, c.x - 3.6 * c.sx);
    x1 = Math.max(x1, c.x + 3.6 * c.sx);
    y0 = Math.min(y0, c.y - 3.6 * c.sy);
    y1 = Math.max(y1, c.y + 3.6 * c.sy);
  }
  x0 = Math.min(x0, -0.15); x1 = Math.max(x1, 0.15);
  y0 = Math.min(y0, -0.15); y1 = Math.max(y1, 0.15);

  const dx = (x1 - x0) / gridN;
  const dy = (y1 - y0) / gridN;
  const cellArea = dx * dy;
  const pdfAt = (u, v) => {
    const q = quadrantOf(u, v);
    if (!unionAllowed.has(q)) return 0;
    let sum = 0;
    for (const c of prep) {
      if (!c.allowed.has(q)) continue;
      const zx = (u - c.x) / c.sx, zy = (v - c.y) / c.sy;
      sum += c.norm * Math.exp(-0.5 * (zx * zx + zy * zy));
    }
    return sum;
  };

  // Cell centers for HDR probability mass threshold
  const samples = [];
  for (let i = 0; i < gridN; i++) {
    const u = x0 + (i + 0.5) * dx;
    for (let j = 0; j < gridN; j++) {
      const v = y0 + (j + 0.5) * dy;
      const f = pdfAt(u, v);
      if (f > 0) samples.push(f);
    }
  }
  if (!samples.length) return { polygons: [], allowed: unionAllowed };
  samples.sort((a, b) => b - a);
  let mass = 0;
  let tau = samples[samples.length - 1];
  for (const f of samples) {
    mass += f * cellArea;
    tau = f;
    if (mass >= pLevel) break;
  }

  // Vertex grid for marching squares (padded outside [x0, x1] x [y0, y1] with 0 so loops always close)
  const M = gridN + 1;
  const val = Array.from({ length: M + 2 }, () => new Float64Array(M + 2));
  const gx = (i) => x0 + (i - 1) * dx;
  const gy = (j) => y0 + (j - 1) * dy;
  for (let i = 1; i <= M; i++) {
    for (let j = 1; j <= M; j++) {
      val[i][j] = pdfAt(gx(i), gy(j));
    }
  }

  const segs = [];
  const interp = (a, b, va, vb) => {
    const den = vb - va;
    const t = Math.abs(den) < 1e-15 ? 0.5 : (tau - va) / den;
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  };
  for (let i = 0; i <= M; i++) {
    for (let j = 0; j <= M; j++) {
      const v00 = val[i][j], v10 = val[i + 1][j], v11 = val[i + 1][j + 1], v01 = val[i][j + 1];
      const code = (v00 >= tau ? 1 : 0) | (v10 >= tau ? 2 : 0) | (v11 >= tau ? 4 : 0) | (v01 >= tau ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const p00 = [gx(i), gy(j)], p10 = [gx(i + 1), gy(j)], p11 = [gx(i + 1), gy(j + 1)], p01 = [gx(i), gy(j + 1)];
      const eB = () => interp(p00, p10, v00, v10);
      const eR = () => interp(p10, p11, v10, v11);
      const eT = () => interp(p01, p11, v01, v11);
      const eL = () => interp(p00, p01, v00, v01);
      const emit = (a, b) => segs.push([a, b]);
      switch (code) {
        case 1: case 14: emit(eL(), eB()); break;
        case 2: case 13: emit(eB(), eR()); break;
        case 3: case 12: emit(eL(), eR()); break;
        case 4: case 11: emit(eR(), eT()); break;
        case 6: case 9: emit(eB(), eT()); break;
        case 7: case 8: emit(eL(), eT()); break;
        case 5: {
          const center = 0.25 * (v00 + v10 + v11 + v01);
          if (center >= tau) { emit(eL(), eT()); emit(eB(), eR()); }
          else { emit(eL(), eB()); emit(eR(), eT()); }
          break;
        }
        case 10: {
          const center = 0.25 * (v00 + v10 + v11 + v01);
          if (center >= tau) { emit(eL(), eB()); emit(eR(), eT()); }
          else { emit(eL(), eT()); emit(eB(), eR()); }
          break;
        }
      }
    }
  }

  const loops = stitchSegments(segs);
  const clipped = [];
  for (const loop of loops) {
    for (const c of clipPolygonToQuadrants(loop, unionAllowed)) clipped.push(c);
  }
  return { polygons: clipped, allowed: unionAllowed };
}

function stitchSegments(segs) {
  const key = (p) => `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)}`;
  const adj = new Map();
  const add = (a, b) => {
    const ka = key(a);
    if (!adj.has(ka)) adj.set(ka, []);
    adj.get(ka).push(b);
  };
  for (const [a, b] of segs) {
    if (key(a) === key(b)) continue;
    add(a, b);
    add(b, a);
  }
  const used = new Set();
  const edgeKey = (a, b) => {
    const ka = key(a), kb = key(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  const loops = [];
  for (const [start] of segs) {
    const ks = key(start);
    const nbrs = adj.get(ks) || [];
    for (const next of nbrs) {
      if (used.has(edgeKey(start, next))) continue;
      const poly = [start];
      let prev = start, cur = next;
      used.add(edgeKey(prev, cur));
      for (let guard = 0; guard < segs.length + 4; guard++) {
        poly.push(cur);
        if (key(cur) === ks) break;
        const cands = adj.get(key(cur)) || [];
        const nxt = cands.find((p) => !used.has(edgeKey(cur, p)));
        if (!nxt) break;
        used.add(edgeKey(cur, nxt));
        prev = cur;
        cur = nxt;
      }
      if (poly.length >= 4 && key(poly[0]) === key(poly[poly.length - 1])) poly.pop();
      if (poly.length >= 3) loops.push(poly);
    }
  }
  return loops;
}

export function polygonsToSvgPath(polygons, X, Y) {
  return polygons
    .filter((p) => p.length >= 3)
    .map((poly) => `M${poly.map(([u, v]) => `${X(u).toFixed(1)},${Y(v).toFixed(1)}`).join("L")}Z`)
    .join(" ");
}
