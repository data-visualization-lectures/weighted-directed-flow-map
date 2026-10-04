(function (root) {
  'use strict';

  // Flow geometry in screen space (y points down). Pure functions, no DOM.
  //
  // Design follows Jenny et al. (2017) "Design principles for origin-destination
  // flow maps": width encodes quantity, arrowheads encode direction, flows are
  // symmetric curves bent consistently (clockwise), and they stop short of nodes.
  // Reciprocal flows (A->B and B->A both drawn) are each shifted to their own left,
  // so the pair reads like a two-lane road with half arrowheads.

  const GAP = 2;
  const MIN_FLOW = 3;
  const ARROW_W = 2.0;
  const ARROW_L = 1.0;
  const MIN_AW = 6;
  const MIN_AL = 5;
  const MAX_AL = 40;
  const CENTER_ARROW = 7;

  const SHAPES = {
    arrow: { taperEnd: 1, arrow: 1, centerline: 0 },
    tapered: { taperEnd: 0.15, arrow: 0, centerline: 0 },
    'tapered-arrow': { taperEnd: 0.5, arrow: 1, centerline: 0 },
    'tapered-centerline': { taperEnd: 0.15, arrow: 0, centerline: 1 },
  };

  function shapeParams(shape) {
    return { ...(SHAPES[shape] || SHAPES.arrow) };
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function leftNormal(p0, p1) {
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const L = Math.hypot(dx, dy) || 1;
    return [dy / L, -dx / L];
  }

  function pairOffset(w, gap = GAP) {
    return w / 2 + gap / 2;
  }

  // Curvature limit so the inner edge never self-intersects: apex radius L/(4k) > w/2.
  function effectiveCurvature(k, L, w) {
    if (!(w > 0)) return k;
    return Math.min(k, (0.9 * L) / (2 * w));
  }

  function controlPolygon({ p0, p1, curvature = 0.2, offset = 0, width = 0 }) {
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const n = leftNormal(p0, p1);
    const k = effectiveCurvature(curvature, L, width);
    const a = [p0[0] + n[0] * offset, p0[1] + n[1] * offset];
    const b = [p1[0] + n[0] * offset, p1[1] + n[1] * offset];
    const c = [(a[0] + b[0]) / 2 + n[0] * k * L, (a[1] + b[1]) / 2 + n[1] * k * L];
    return { a, b, c, n, L, k };
  }

  function quad(a, c, b, t) {
    const u = 1 - t;
    return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
  }

  function quadDeriv(a, c, b, t) {
    const u = 1 - t;
    return [2 * u * (c[0] - a[0]) + 2 * t * (b[0] - c[0]), 2 * u * (c[1] - a[1]) + 2 * t * (b[1] - c[1])];
  }

  function buildLut(a, c, b, n) {
    const ts = new Array(n + 1);
    const pts = new Array(n + 1);
    const s = new Array(n + 1);
    let acc = 0;
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      const p = quad(a, c, b, t);
      if (i > 0) acc += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
      ts[i] = t;
      pts[i] = p;
      s[i] = acc;
    }
    return { ts, pts, s, length: acc };
  }

  function tAtS(lut, target) {
    const { s, ts } = lut;
    if (target <= 0) return 0;
    if (target >= lut.length) return 1;
    let lo = 0;
    let hi = s.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid] < target) lo = mid;
      else hi = mid;
    }
    const span = s[hi] - s[lo] || 1;
    return ts[lo] + ((target - s[lo]) / span) * (ts[hi] - ts[lo]);
  }

  // Arc length where the curve first gets `dist` away from `center`, scanning from the start or end.
  function trimByDistance(lut, center, dist, fromStart) {
    const { pts, s } = lut;
    const n = pts.length;
    const d = (p) => Math.hypot(p[0] - center[0], p[1] - center[1]);
    if (fromStart) {
      if (d(pts[0]) >= dist) return 0;
      for (let i = 1; i < n; i += 1) {
        const di = d(pts[i]);
        if (di >= dist) {
          const dp = d(pts[i - 1]);
          const f = (dist - dp) / ((di - dp) || 1);
          return s[i - 1] + f * (s[i] - s[i - 1]);
        }
      }
      return lut.length;
    }
    if (d(pts[n - 1]) >= dist) return lut.length;
    for (let i = n - 2; i >= 0; i -= 1) {
      const di = d(pts[i]);
      if (di >= dist) {
        const dn = d(pts[i + 1]);
        const f = (dist - dn) / ((di - dn) || 1);
        return s[i + 1] - f * (s[i + 1] - s[i]);
      }
    }
    return 0;
  }

  function fmt(v) {
    return Math.round(v * 10) / 10;
  }

  function pathFrom(points, close) {
    if (!points.length) return '';
    let d = `M${fmt(points[0][0])},${fmt(points[0][1])}`;
    for (let i = 1; i < points.length; i += 1) d += `L${fmt(points[i][0])},${fmt(points[i][1])}`;
    return close ? `${d}Z` : d;
  }

  /**
   * Builds the outline of one flow as a single closed path.
   * o: { p0, p1, width, curvature, offset, rStart, rEnd, gap, halfInner,
   *      taperEnd, arrow, centerline, density }
   * Returns { status: 'ok'|'short'|'degenerate', d, centerD, arrowD, tip, length, samples, bbox, ringSize }
   */
  function flowOutline(o) {
    const p0 = o.p0;
    const p1 = o.p1;
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    if (!(L >= 0.5) || !Number.isFinite(L)) return { status: 'degenerate' };
    const w = Math.max(0, Number(o.width) || 0);
    const gap = o.gap == null ? GAP : o.gap;
    const taperEnd = o.taperEnd == null ? 1 : clamp(o.taperEnd, 0, 1);
    const arrow = o.arrow == null ? 1 : clamp(o.arrow, 0, 1);
    const centerline = o.centerline == null ? 0 : clamp(o.centerline, 0, 1);
    const density = o.density || 1;
    const poly = controlPolygon({ p0, p1, curvature: Math.max(0, o.curvature || 0), offset: o.offset || 0, width: w });
    const { a, b, c } = poly;
    const lut = buildLut(a, c, b, Math.round(clamp(L / 6, 8, 64) * density) || 8);

    // Offset lanes trim a little further so the inner corner stays outside the node disc.
    const laneExtra = Math.abs(o.offset || 0) * 0.5;
    let sS = trimByDistance(lut, p0, (o.rStart || 0) + gap + laneExtra, true);
    let sE = trimByDistance(lut, p1, (o.rEnd || 0) + gap + laneExtra, false);
    // Neighbouring places with wide flows (e.g. 東京↔神奈川) leave almost nothing after
    // trimming; let such flows run under the node discs instead (nodes are drawn on top).
    if (sE - sS < Math.max(MIN_FLOW, 1.5 * w)) {
      sS = trimByDistance(lut, p0, gap + laneExtra, true);
      sE = trimByDistance(lut, p1, gap + laneExtra, false);
      if (sE - sS < MIN_FLOW) return { status: 'short' };
    }
    const avail = sE - sS;

    let aw = Math.max(MIN_AW, w * ARROW_W);
    let al = clamp(aw * ARROW_L, MIN_AL, MAX_AL);
    if (al > 0.5 * avail) {
      al = 0.5 * avail;
      aw = Math.max(w * 1.2, al / ARROW_L);
    }
    const headLen = al * arrow;
    const sB = sE - headLen;

    // Point count depends on length only, so every shape yields the same ring size.
    const M = Math.round(clamp(L / 5, 6, 48) * density) || 6;
    const left = [];
    const right = [];
    const samples = [];
    let lastN = [0, -1];
    let lastP = a;
    let lastWb = w;
    for (let j = 0; j <= M; j += 1) {
      const u = j / M;
      const s = sS + (sB - sS) * u;
      const t = tAtS(lut, s);
      const P = quad(a, c, b, t);
      const D = quadDeriv(a, c, b, t);
      const len = Math.hypot(D[0], D[1]) || 1;
      const N = [D[1] / len, -D[0] / len];
      const wb = w * (1 - (1 - taperEnd) * u);
      left.push([P[0] + (N[0] * wb) / 2, P[1] + (N[1] * wb) / 2]);
      right.push([P[0] - (N[0] * wb) / 2, P[1] - (N[1] * wb) / 2]);
      samples.push({ x: P[0], y: P[1], hw: wb / 2 });
      lastN = N;
      lastP = P;
      lastWb = wb;
    }
    const tTip = tAtS(lut, sE);
    const tipCenter = quad(a, c, b, tTip);
    // Head width blends toward the body width as the arrowhead fades out (for tweens).
    const headW = lastWb + (Math.max(aw, lastWb) - lastWb) * arrow;
    let leftBarb;
    let rightBarb;
    let tip;
    if (o.halfInner) {
      const protrude = ((headW - lastWb) / 2) * 1.5;
      leftBarb = [left[M][0] + lastN[0] * protrude, left[M][1] + lastN[1] * protrude];
      rightBarb = right[M];
      // The tip sits on the inner edge so that edge stays straight next to the partner flow.
      tip = [tipCenter[0] - (lastN[0] * lastWb * arrow) / 2, tipCenter[1] - (lastN[1] * lastWb * arrow) / 2];
    } else {
      leftBarb = [lastP[0] + (lastN[0] * headW) / 2, lastP[1] + (lastN[1] * headW) / 2];
      rightBarb = [lastP[0] - (lastN[0] * headW) / 2, lastP[1] - (lastN[1] * headW) / 2];
      tip = tipCenter;
    }
    samples.push({ x: tip[0], y: tip[1], hw: 1 });
    const ring = [...left, leftBarb, tip, rightBarb, ...right.slice().reverse()];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    ring.forEach(([x, y]) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    });

    let centerD = '';
    let arrowD = '';
    if (centerline > 0 && avail > CENTER_ARROW * 1.5) {
      const line = [];
      const sLineEnd = sE - CENTER_ARROW;
      for (let j = 0; j <= M; j += 1) {
        const s = sS + (sLineEnd - sS) * (j / M);
        line.push(quad(a, c, b, tAtS(lut, s)));
      }
      centerD = pathFrom(line, false);
      const tBase = tAtS(lut, sLineEnd);
      const base = quad(a, c, b, tBase);
      const D = quadDeriv(a, c, b, tBase);
      const len = Math.hypot(D[0], D[1]) || 1;
      const N = [D[1] / len, -D[0] / len];
      const half = CENTER_ARROW / 2;
      arrowD = pathFrom([
        [base[0] + N[0] * half, base[1] + N[1] * half],
        tipCenter,
        [base[0] - N[0] * half, base[1] - N[1] * half],
      ], true);
    }

    return {
      status: 'ok',
      d: pathFrom(ring, true),
      centerD,
      arrowD,
      tip,
      length: avail,
      samples,
      bbox: [minX, minY, maxX, maxY],
      ringSize: ring.length,
      curvature: poly.k,
    };
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // Interpolates outline parameters for 1 s tweens.
  function lerpParams(from, to, t) {
    const out = { ...to };
    ['width', 'curvature', 'offset', 'rStart', 'rEnd', 'taperEnd', 'arrow', 'centerline'].forEach((key) => {
      const fa = Number(from[key]);
      const tb = Number(to[key]);
      if (Number.isFinite(fa) && Number.isFinite(tb)) out[key] = lerp(fa, tb, t);
    });
    ['p0', 'p1'].forEach((key) => {
      if (from[key] && to[key]) out[key] = [lerp(from[key][0], to[key][0], t), lerp(from[key][1], to[key][1], t)];
    });
    out.halfInner = t < 0.5 ? from.halfInner : to.halfInner;
    return out;
  }

  function wrap180(x) {
    return ((((x + 180) % 360) + 360) % 360) - 180;
  }

  function round5(x) {
    const r = Math.round(x / 5) * 5;
    return r === -180 ? 180 : r;
  }

  // Centre of the antipode of the largest empty longitude gap.
  function largestGapCenter(lons) {
    const S = [...new Set((lons || []).filter(Number.isFinite).map(wrap180))].sort((x, y) => x - y);
    if (!S.length) return 0;
    if (S.length === 1) return round5(S[0]);
    let best = { size: -1, mid: 0 };
    for (let i = 0; i < S.length; i += 1) {
      const lo = S[i];
      const hi = i === S.length - 1 ? S[0] + 360 : S[i + 1];
      const size = hi - lo;
      if (size > best.size) best = { size, mid: (lo + hi) / 2 };
    }
    return round5(wrap180(best.mid - 180));
  }

  /**
   * Picks the projection centre longitude. Minimises the value-weighted longitude
   * span of flows in the rotated frame (5 degree steps). Many centres usually tie
   * (any seam that crosses no flow); the middle of the longest run of tied
   * centres wins, so the seam sits in the middle of the emptiest ocean.
   * flows: [{lon0, lon1, value}], lons: node longitudes (used when there are no flows).
   */
  function autoCenterLongitude(flows, lons) {
    const list = (flows || []).filter((f) => Number.isFinite(f.lon0) && Number.isFinite(f.lon1));
    if (!list.length) return largestGapCenter(lons || []);
    const STEP = 5;
    const centers = [];
    for (let c = -180; c < 180; c += STEP) centers.push(c);
    const costs = centers.map((c) => list.reduce(
      (acc, f) => acc + (f.value || 1) * Math.abs(wrap180(f.lon0 - c) - wrap180(f.lon1 - c)),
      0,
    ));
    const min = Math.min(...costs);
    const eps = 1e-9 * Math.max(1, min);
    const tied = costs.map((v) => v <= min + eps);
    const n = centers.length;
    if (tied.every(Boolean)) return largestGapCenter(lons && lons.length ? lons : list.flatMap((f) => [f.lon0, f.lon1]));
    let best = { len: 0, start: 0 };
    for (let i = 0; i < n; i += 1) {
      if (!tied[i] || tied[(i - 1 + n) % n]) continue;
      let len = 0;
      while (len < n && tied[(i + len) % n]) len += 1;
      if (len > best.len) best = { len, start: i };
    }
    const mid = centers[best.start] + ((best.len - 1) * STEP) / 2;
    return round5(wrap180(mid));
  }

  // Count of flows that go "the long way" (> 180 degrees in the rotated frame).
  function longWayCount(flows, center) {
    return (flows || []).filter((f) => Math.abs(wrap180(f.lon0 - center) - wrap180(f.lon1 - center)) > 180).length;
  }

  function boxesOverlap(a, b) {
    return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  }

  /**
   * Greedy label placement. items: [{id, x, y, r, text, priority}] (higher priority first).
   * measure(text) -> {w, h}. viewport: [x0, y0, x1, y1]. obstacles: extra boxes.
   */
  function placeLabels(items, measure, viewport, obstacles = []) {
    const placed = [];
    const boxes = obstacles.slice();
    const sorted = items.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
    sorted.forEach((item) => {
      const { w, h } = measure(item.text);
      const r = (item.r || 0) + 3;
      const candidates = [
        { x: item.x + r, y: item.y, anchor: 'start', box: [item.x + r, item.y - h / 2, item.x + r + w, item.y + h / 2] },
        { x: item.x - r, y: item.y, anchor: 'end', box: [item.x - r - w, item.y - h / 2, item.x - r, item.y + h / 2] },
        { x: item.x, y: item.y - r - h / 2, anchor: 'middle', box: [item.x - w / 2, item.y - r - h, item.x + w / 2, item.y - r] },
        { x: item.x, y: item.y + r + h / 2, anchor: 'middle', box: [item.x - w / 2, item.y + r, item.x + w / 2, item.y + r + h] },
      ];
      const fit = candidates.find((cand) => {
        const bx = cand.box;
        if (viewport && (bx[0] < viewport[0] || bx[1] < viewport[1] || bx[2] > viewport[2] || bx[3] > viewport[3])) return false;
        return !boxes.some((other) => boxesOverlap(bx, other));
      });
      if (!fit) return;
      boxes.push(fit.box);
      placed.push({ id: item.id, text: item.text, x: fit.x, y: fit.y, anchor: fit.anchor, box: fit.box });
    });
    return placed;
  }

  // Inset frame for Okinawa, top-left, shrunk until it clears obstacle boxes.
  function placeInsetFrame(width, height, obstacleBoxes = [], pad = 12) {
    let w = Math.min(0.28 * width, 260);
    let h = Math.min(0.22 * height, 180);
    for (let i = 0; i < 6; i += 1) {
      const box = [pad, pad, pad + w, pad + h];
      if (!obstacleBoxes.some((o) => boxesOverlap(box, o))) return { x: pad, y: pad, w, h };
      w *= 0.85;
      h *= 0.85;
    }
    return { x: pad, y: pad, w, h };
  }

  root.FlowGeometry = {
    GAP,
    MIN_FLOW,
    SHAPES,
    shapeParams,
    leftNormal,
    pairOffset,
    effectiveCurvature,
    controlPolygon,
    buildLut,
    trimByDistance,
    flowOutline,
    lerpParams,
    wrap180,
    largestGapCenter,
    autoCenterLongitude,
    longWayCount,
    placeLabels,
    placeInsetFrame,
    boxesOverlap,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.FlowGeometry;
}
