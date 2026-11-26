import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  quadrantOf,
  allowedQuadrants,
  calibrateTruncatedRadius,
  singleComponentPolygons,
  mixtureHdrPolygons,
  clipPolygonToQuadrants,
} from "../../frontend/regions.js";

const snap = JSON.parse(readFileSync(new URL("../../data/latest.json", import.meta.url)));

function allPointsInsideAllowed(polygons, allowed, eps = 1e-6) {
  for (const poly of polygons) {
    for (const [x, y] of poly) {
      const qx = Math.abs(x) <= eps ? 0 : x;
      const qy = Math.abs(y) <= eps ? 0 : y;
      // On boundary (qx===0 or qy===0), check adjacent quadrants
      const xs = qx === 0 ? [1, -1] : [qx];
      const ys = qy === 0 ? [1, -1] : [qy];
      const ok = xs.some((ux) => ys.some((vy) => allowed.has(quadrantOf(ux, vy))));
      if (!ok) return { ok: false, bad: [x, y] };
    }
  }
  return { ok: true };
}

test("single view stays strictly inside plausible_quadrants", () => {
  for (const v of snap.views) {
    const allowed = allowedQuadrants(v);
    for (const pLevel of [0.68, 0.90]) {
      const { polygons } = singleComponentPolygons(v, pLevel);
      assert.ok(polygons.length >= 1, `${v.id} has polygon at ${pLevel}`);
      const res = allPointsInsideAllowed(polygons, allowed);
      assert.ok(res.ok, `${v.id} at ${pLevel} leaked point ${res.bad} outside ${[...allowed]}`);
    }
  }
});

test("model point stays strictly in overheating when only overheating is plausible", () => {
  const m = snap.model.point;
  const { polygons, allowed } = singleComponentPolygons(m, 0.90);
  assert.deepEqual([...allowed], ["overheating"]);
  const res = allPointsInsideAllowed(polygons, allowed);
  assert.ok(res.ok, `model leaked point ${res.bad}`);
});

test("3-quadrant L-shape clipping excises forbidden quadrant cleanly", () => {
  const diamond = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const allowed = new Set(["overheating", "stagflation", "goldilocks"]);
  const clipped = clipPolygonToQuadrants(diamond, allowed);
  assert.equal(clipped.length, 1);
  const res = allPointsInsideAllowed(clipped, allowed);
  assert.ok(res.ok, `L-shape leaked point ${res.bad}`);
  assert.ok(clipped[0].some(([x, y]) => Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9), "includes origin corner");
});

test("blended mixture HDR contour stays strictly inside union of plausible quadrants", () => {
  const comps = [
    ...snap.views.map((v) => ({ x: v.x, sx: v.sx, y: v.y, sy: v.sy, w: v.weight * 0.6, plausible_quadrants: v.plausible_quadrants })),
    { ...snap.model.point, w: 0.4 },
  ];
  for (const pLevel of [0.68, 0.90]) {
    const { polygons, allowed } = mixtureHdrPolygons(comps, pLevel);
    assert.ok(polygons.length >= 1, `blended HDR produces polygon(s) at ${pLevel}`);
    assert.deepEqual([...allowed].sort(), ["overheating", "stagflation"]);
    const res = allPointsInsideAllowed(polygons, allowed);
    assert.ok(res.ok, `blended HDR leaked point ${res.bad} outside ${[...allowed]}`);
  }
});

test("4-quadrant unrestricted radius matches chi-square quantile", () => {
  const r68 = calibrateTruncatedRadius(0, 1, 0, 1, new Set(["goldilocks", "overheating", "stagflation", "slowdown"]), 0.68);
  assert.ok(Math.abs(r68 - Math.sqrt(-2 * Math.log(1 - 0.68))) < 1e-6);
});
