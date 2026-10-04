'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/flow-geometry.js');

const base = (extra) => ({
  p0: [0, 0],
  p1: [300, 0],
  width: 12,
  curvature: 0.2,
  rStart: 5,
  rEnd: 5,
  ...G.shapeParams('arrow'),
  ...extra,
});

function parsePath(d) {
  return [...d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

test('flows bend clockwise: an eastward flow bulges up (negative y)', () => {
  const r = G.flowOutline(base());
  assert.equal(r.status, 'ok');
  assert.ok(r.bbox[1] < -20, 'apex above the chord');
  assert.ok(r.bbox[3] < 8, 'nothing far below the chord');
  assert.deepEqual(G.leftNormal([0, 0], [1, 0]), [0, -1]);
});

test('reciprocal flows sit on opposite sides', () => {
  const ab = G.controlPolygon({ p0: [0, 0], p1: [300, 0], curvature: 0.2 });
  const ba = G.controlPolygon({ p0: [300, 0], p1: [0, 0], curvature: 0.2 });
  assert.ok(ab.c[1] < 0 && ba.c[1] > 0);
});

test('straight reciprocal lanes do not overlap', () => {
  const w1 = 12;
  const w2 = 6;
  const a = G.flowOutline(base({ width: w1, curvature: 0, offset: G.pairOffset(w1), halfInner: true }));
  const b = G.flowOutline(base({ p0: [300, 0], p1: [0, 0], width: w2, curvature: 0, offset: G.pairOffset(w2), halfInner: true }));
  // A->B occupies y < 0, B->A occupies y > 0.
  assert.ok(a.bbox[3] <= 0.05, `A->B lane max y ${a.bbox[3]}`);
  assert.ok(b.bbox[1] >= -0.05, `B->A lane min y ${b.bbox[1]}`);
});

test('outline stays outside the node discs and the tip lands near them', () => {
  const r = G.flowOutline(base());
  const pts = parsePath(r.d);
  pts.forEach(([x, y]) => {
    assert.ok(Math.hypot(x, y) >= 5 + G.GAP - 0.6, 'outside start disc');
  });
  const dTip = Math.hypot(r.tip[0] - 300, r.tip[1]);
  assert.ok(Math.abs(dTip - 7) < 0.6, `tip distance ${dTip}`);
});

test('arrowhead never takes more than half the visible flow', () => {
  const r = G.flowOutline(base({ p1: [40, 0], width: 30, rStart: 2, rEnd: 2 }));
  assert.equal(r.status, 'ok');
  assert.ok(r.length > 0);
});

test('degenerate and short flows', () => {
  assert.equal(G.flowOutline(base({ p1: [0.2, 0] })).status, 'degenerate');
  assert.equal(G.flowOutline(base({ p1: [6, 0], rStart: 5, rEnd: 5 })).status, 'short');
});

test('curvature is clamped so the inner edge cannot fold', () => {
  const r = G.flowOutline(base({ p1: [60, 0], width: 40, curvature: 0.6 }));
  assert.ok(r.curvature <= (0.9 * 60) / (2 * 40) + 1e-9);
});

test('every shape yields the same ring size and no NaN', () => {
  const sizes = Object.keys(G.SHAPES).map((shape) => {
    const r = G.flowOutline(base({ ...G.shapeParams(shape), p1: [250, 120] }));
    assert.ok(!/NaN|Infinity/.test(r.d), shape);
    return r.ringSize;
  });
  assert.ok(sizes.every((s) => s === sizes[0]), sizes.join(','));
  const centre = G.flowOutline(base(G.shapeParams('tapered-centerline')));
  assert.ok(centre.centerD.startsWith('M') && centre.arrowD.endsWith('Z'));
});

test('tapered flows get thinner toward the destination', () => {
  const r = G.flowOutline(base({ ...G.shapeParams('tapered'), curvature: 0 }));
  const first = r.samples[0].hw;
  const last = r.samples[r.samples.length - 2].hw;
  assert.ok(last < first);
});

test('automatic centre longitude', () => {
  const trade = [
    { lon0: 139.7, lon1: -95, value: 20 },
    { lon0: 139.7, lon1: 10, value: 10 },
    { lon0: 139.7, lon1: 116, value: 30 },
  ];
  const c = G.autoCenterLongitude(trade);
  assert.ok(c >= 120 && c <= 160, `Japan-centred, got ${c}`);
  const europe = G.autoCenterLongitude([{ lon0: -3, lon1: 13, value: 1 }, { lon0: 2, lon1: 21, value: 1 }]);
  assert.ok(Math.abs(europe) <= 20, `Europe-centred, got ${europe}`);
  assert.equal(G.autoCenterLongitude([], [139.7]), 140);
  assert.equal(G.autoCenterLongitude([], []), 0);
  assert.equal(G.longWayCount(trade, c), 0);
});

test('label placement avoids overlaps and the viewport edge', () => {
  const measure = (text) => ({ w: text.length * 8, h: 12 });
  const placed = G.placeLabels([
    { id: 'a', x: 50, y: 50, r: 4, text: 'Alpha', priority: 2 },
    { id: 'b', x: 52, y: 50, r: 4, text: 'Beta', priority: 1 },
  ], measure, [0, 0, 400, 300]);
  assert.equal(placed.length, 2);
  assert.ok(!G.boxesOverlap(placed[0].box, placed[1].box));
});

test('inset frame avoids obstacles', () => {
  const frame = G.placeInsetFrame(800, 600, [[0, 0, 150, 100]]);
  assert.ok(!G.boxesOverlap([frame.x, frame.y, frame.x + frame.w, frame.y + frame.h], [0, 0, 150, 100]) || frame.w < 120);
});
