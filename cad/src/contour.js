// Contour fitting: turn a sculpted ring's band into a parametric shape.
//
// The ring (finger axis Z, head at +Y, as fit=ring leaves it) is sliced like a
// loaf by half-planes through the finger axis, every few degrees round the
// finger. Each slice is the band's cross-section there, a closed curve in
// (r, z): r out from the axis, z across the band. Each curve is traced with
// a smooth closed spline of a few control points; the band is rebuilt by
// blending from one traced section to the next. The head, where the shape is
// not a band, is kept from the original mesh and joined on.
import { kernelModule } from "./kernel.js";

const TAU = Math.PI * 2;

// ---------- slicing ----------
// The section of the solid in the half-plane at angle theta (radians, 0 =
// the top, +Y; increasing towards +X). Returns closed polygons in (r, z).
export function radialSections(manifold, count = 72) {
  const out = new Map();
  for (let k = 0; k < count / 2; k++) {
    const theta = (k / count) * TAU;
    // turn the plane through the axis at theta into z = 0:
    // radial direction -> +X, then the plane's normal -> +Z
    const deg = (theta * 180) / Math.PI;
    const turned = manifold.rotate([0, 0, deg - 90]);
    const flat = turned.rotate([90, 0, 0]);
    const cs = flat.slice(0);
    const polys = cs.toPolygons();
    cs.delete();
    flat.delete();
    turned.delete();
    // after the turns: X = r on the theta side (and -r on the opposite side),
    // the slice's second coordinate = -z
    const sides = [[], []];
    for (const poly of polys) {
      const pts = poly.map(([x, y]) => [x, -y]);
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      if (cx >= 0) sides[0].push(pts);
      else sides[1].push(pts.map(([x, z]) => [-x, z]).reverse());
    }
    out.set(k, sides[0]);
    out.set(k + count / 2, sides[1]);
  }
  return [...Array(count).keys()].map((k) => ({ theta: (k / count) * TAU, polys: out.get(k) || [] }));
}

const area2 = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
};

// ---------- tracing one section ----------
// Resample a closed polygon to n points evenly along its length, starting
// on its inner side (nearest the finger) level with its middle, running
// counter-clockwise, so sections round the ring line up point for point.
export function resampleSection(poly, n = 96) {
  let pts = area2(poly) < 0 ? poly.slice().reverse() : poly.slice();
  const zMid = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  // start: where the outline crosses z = zMid with the smallest r
  let best = 0, bestR = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [r1, z1] = pts[i], [r2, z2] = pts[(i + 1) % pts.length];
    if ((z1 - zMid) * (z2 - zMid) > 0 || z1 === z2) continue;
    const t = (zMid - z1) / (z2 - z1);
    const r = r1 + (r2 - r1) * t;
    if (r < bestR) [bestR, best] = [r, i];
  }
  pts = [...pts.slice(best + 1), ...pts.slice(0, best + 1)];
  pts.unshift([bestR === Infinity ? pts[0][0] : bestR, zMid]);
  const seg = [];
  let L = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    seg.push(l);
    L += l;
  }
  const out = [];
  let i = 0, acc = 0;
  for (let k = 0; k < n; k++) {
    const s = (k / n) * L;
    while (acc + seg[i] < s && i < seg.length - 1) acc += seg[i++];
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const t = seg[i] ? (s - acc) / seg[i] : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

// Closed uniform cubic B-spline through K control points.
const basis = (u) => [(1 - u) ** 3 / 6, (3 * u ** 3 - 6 * u ** 2 + 4) / 6, (-3 * u ** 3 + 3 * u ** 2 + 3 * u + 1) / 6, u ** 3 / 6];
export function splinePoint(ctrl, t) {
  const K = ctrl.length;
  const s = (((t % 1) + 1) % 1) * K;
  const i = Math.floor(s), u = s - i;
  const b = basis(u);
  let x = 0, y = 0;
  for (let j = 0; j < 4; j++) {
    const c = ctrl[(i + j - 1 + K) % K];
    x += b[j] * c[0];
    y += b[j] * c[1];
  }
  return [x, y];
}
// Least-squares control points for samples evenly spaced in t.
function fitSpline(samples, K) {
  const n = samples.length;
  const AtA = Array.from({ length: K }, () => new Float64Array(K));
  const Atx = new Float64Array(K), Aty = new Float64Array(K);
  for (let k = 0; k < n; k++) {
    const s = (k / n) * K;
    const i = Math.floor(s), u = s - i;
    const b = basis(u);
    const idx = [0, 1, 2, 3].map((j) => (i + j - 1 + K) % K);
    for (let a = 0; a < 4; a++) {
      Atx[idx[a]] += b[a] * samples[k][0];
      Aty[idx[a]] += b[a] * samples[k][1];
      for (let c = 0; c < 4; c++) AtA[idx[a]][idx[c]] += b[a] * b[c];
    }
  }
  const solve = (rhs) => {
    const M = AtA.map((row, r) => [...row, rhs[r]]);
    for (let c = 0; c < K; c++) {
      let p = c;
      for (let r = c + 1; r < K; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < K; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let j = c; j <= K; j++) M[r][j] -= f * M[c][j];
      }
    }
    return M.map((row, r) => row[K] / row[r]);
  };
  const xs = solve(Atx), ys = solve(Aty);
  return xs.map((x, k) => [x, ys[k]]);
}
// Trace a section with as few control points as keep it within `tol` mm.
export function traceSection(samples, tol = 0.03, maxK = 40) {
  let best = null;
  for (let K = 8; K <= maxK; K += 4) {
    const ctrl = fitSpline(samples, K);
    let err = 0;
    for (let k = 0; k < samples.length; k++) {
      const [x, y] = splinePoint(ctrl, k / samples.length);
      err = Math.max(err, Math.hypot(x - samples[k][0], y - samples[k][1]));
    }
    best = { ctrl, err };
    if (err <= tol) break;
  }
  return best;
}

// ---------- the whole band ----------
// Fit the band. Each section is traced; a section belongs to the head when
// it isn't one clean outline (prongs and stones show up as separate islands)
// or no smooth curve of up to 40 points follows it. The head is the run of
// such sections round the top, plus a margin; it is kept from the original
// and the band is blended underneath it.
// Returns { sections: [{theta, ctrl, err}], head: {from, to} | null (in
// section steps, may be negative), count, maxError }.
export function fitBand(manifold, { count = 72, tol = 0.03 } = {}) {
  const raw = radialSections(manifold, count);
  const traced = raw.map((sec) => {
    if (!sec.polys.length) return null;
    const sorted = sec.polys.slice().sort((a, b) => Math.abs(area2(b)) - Math.abs(area2(a)));
    const main = sorted[0];
    const islands = sorted.slice(1).filter((p) => Math.abs(area2(p)) > 0.02 * Math.abs(area2(main))).length;
    const t = traceSection(resampleSection(main), tol);
    return { theta: sec.theta, ctrl: t.ctrl, err: t.err, clean: !islands && t.err <= 2 * tol };
  });
  const n = count;
  // how far out each section reaches; a prong or stone shows up as a bump
  // over the sections a few degrees either side (a shank that widens into a
  // signet face changes gradually, so it stays band)
  const reach = raw.map((sec) => Math.max(0, ...sec.polys.flat().map((p) => p[0])));
  const at = (k) => reach[((k % n) + n) % n];
  const bump = (k) => at(k) - (at(k - 3) + at(k + 3)) / 2 > 0.4;
  const odd = (k) => {
    const t = traced[((k % n) + n) % n];
    return !t || !t.clean || bump(k);
  };
  // the head: every odd section in the top half, as one span round the top
  let head = null;
  const top = [];
  for (let k = -Math.floor(n / 4); k <= Math.floor(n / 4); k++) if (odd(k)) top.push(k);
  if (top.length) {
    const margin = 2;
    head = { from: Math.min(...top) - margin, to: Math.max(...top) + margin };
  }
  const inHead = (k) => head && (k - head.from + 2 * n) % n <= head.to - head.from;
  const sections = [];
  let maxError = 0;
  for (let k = 0; k < n; k++) {
    if (inHead(k) || !traced[k]) continue;
    sections.push({ theta: traced[k].theta, ctrl: traced[k].ctrl, err: traced[k].err });
    maxError = Math.max(maxError, traced[k].err);
  }
  return { sections, head, count, maxError, unclean: traced.filter((t) => t && !t.clean).length };
}

// Same number of control points everywhere, so sections can be blended.
function resampleCtrl(ctrl, K) {
  if (ctrl.length === K) return ctrl;
  const pts = Array.from({ length: 160 }, (_, i) => splinePoint(ctrl, i / 160));
  return fitSpline(pts, K);
}

// Rebuild the band as a closed solid all the way round: sections blended
// round the ring (periodic cubic in angle), bridging under the head.
export function bandSolid(fit, { around = 180, along = 64 } = {}) {
  const { Manifold, Mesh } = kernelModule();
  const K = Math.max(...fit.sections.map((s) => s.ctrl.length));
  const secs = fit.sections.map((s) => ({ theta: s.theta, ctrl: resampleCtrl(s.ctrl, K) })).sort((a, b) => a.theta - b.theta);
  const m = secs.length;
  // section at any angle: Catmull-Rom between neighbouring traced sections
  const at = (theta) => {
    let j = secs.findIndex((s) => s.theta > theta);
    if (j < 0) j = 0;
    const i1 = (j - 1 + m) % m, i2 = j;
    const t1 = secs[i1].theta, t2 = secs[i2].theta + (secs[i2].theta <= t1 ? TAU : 0);
    const th = theta < t1 ? theta + TAU : theta;
    const u = (th - t1) / (t2 - t1);
    const p0 = secs[(i1 - 1 + m) % m].ctrl, p1 = secs[i1].ctrl, p2 = secs[i2].ctrl, p3 = secs[(i2 + 1) % m].ctrl;
    const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
    return p1.map((_, k) => [cr(p0[k][0], p1[k][0], p2[k][0], p3[k][0]), cr(p0[k][1], p1[k][1], p2[k][1], p3[k][1])]);
  };
  const verts = [];
  for (let a = 0; a < around; a++) {
    const theta = (a / around) * TAU;
    const ctrl = at(theta);
    const sx = Math.sin(theta), cy = Math.cos(theta);
    for (let b = 0; b < along; b++) {
      const [r, z] = splinePoint(ctrl, b / along);
      verts.push(r * sx, r * cy, z);
    }
  }
  const tris = [];
  const id = (a, b) => (a % around) * along + (b % along);
  for (let a = 0; a < around; a++) for (let b = 0; b < along; b++) {
    const [p, q, r, s] = [id(a, b), id(a + 1, b), id(a + 1, b + 1), id(a, b + 1)];
    tris.push(p, r, q, p, s, r);
  }
  const mesh = new Mesh({ numProp: 3, vertProperties: Float32Array.from(verts), triVerts: Uint32Array.from(tris) });
  mesh.merge();
  let solid = new Manifold(mesh);
  if (solid.volume() < 0) {
    // the winding came out inside-out: flip every triangle
    const flipped = [];
    for (let i = 0; i < tris.length; i += 3) flipped.push(tris[i], tris[i + 2], tris[i + 1]);
    solid.delete();
    const m2 = new Mesh({ numProp: 3, vertProperties: Float32Array.from(verts), triVerts: Uint32Array.from(flipped) });
    m2.merge();
    solid = new Manifold(m2);
  }
  return solid;
}

// The wedge of angles the head spans (a little wider), as a solid.
export function headWedge(fit, inset = 0) {
  const { Manifold, CrossSection } = kernelModule();
  const a0 = ((fit.head.from - 0.5 + inset) / fit.count) * TAU, a1 = ((fit.head.to + 0.5 - inset) / fit.count) * TAU;
  const R = 200;
  const pts = [[0, 0]];
  for (let i = 0; i <= 24; i++) {
    const t = a0 + ((a1 - a0) * i) / 24;
    pts.push([R * Math.sin(t), R * Math.cos(t)]);
  }
  const cs = new CrossSection([pts.reverse()]); // counter-clockwise
  const wedge = Manifold.extrude(cs, 400).translate([0, 0, -200]);
  cs.delete();
  return wedge;
}

// Reshape the traced band: width (along the finger) and thickness (out from
// the bore, which stays put) as factors. Near the head the change fades out
// over a few sections, so the band still meets the head as it was.
export function reshapeBand(fit, { width = 1, thickness = 1 } = {}) {
  if (width === 1 && thickness === 1) return fit;
  const n = fit.count, step = TAU / n;
  const fade = 6; // sections
  const sections = fit.sections.map((sec) => {
    let ramp = 1;
    if (fit.head) {
      const k = Math.round(sec.theta / step);
      const d = Math.min(...[fit.head.from, fit.head.to].map((e) => Math.min(Math.abs(((k - e) % n + n) % n), Math.abs(((e - k) % n + n) % n))));
      // nothing at all next to the head (the band reaches a slice into it)
      ramp = Math.min(1, Math.max(0, (d - 1) / fade));
    }
    const w = 1 + (width - 1) * ramp, t = 1 + (thickness - 1) * ramp;
    const pts = Array.from({ length: 64 }, (_, i) => splinePoint(sec.ctrl, i / 64));
    const rIn = Math.min(...pts.map((p) => p[0]));
    const zs = pts.map((p) => p[1]);
    const zc = (Math.min(...zs) + Math.max(...zs)) / 2;
    return { ...sec, ctrl: sec.ctrl.map(([r, z]) => [rIn + (r - rIn) * t, zc + (z - zc) * w]) };
  });
  return { ...fit, sections };
}

// The rebuilt ring: the traced band outside the head's wedge, and the
// original's own material inside it (head, and whatever the band does under
// the head, such as splitting into two rails). Returns { solid, band, head }.
export function rebuildRing(manifold, fit) {
  const { Manifold } = kernelModule();
  const full = bandSolid(fit);
  if (!fit.head) return { solid: full, band: full, head: null };
  // the band reaches one slice into the head's wedge, so the two overlap and
  // fuse rather than just touching at the cut
  const wedge = headWedge(fit), inner = headWedge(fit, 1);
  const band = Manifold.difference(full, inner);
  const head = Manifold.intersection(manifold, wedge);
  const solid = Manifold.union(band, head);
  full.delete();
  wedge.delete();
  inner.delete();
  return { solid, band, head };
}
