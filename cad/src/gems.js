import * as THREE from "three";
import { fixWinding } from "./geom.js";

// width is the stone's smaller dimension (the "dia" in the script); the outline
// has half-width hw (x) and half-length hl (z). k estimates diamond carats as
// k * width^3 * aspect (rough, for tech-sheet estimates only).
const TAU = Math.PI * 2;
const ring = (n, f) => Array.from({ length: n }, (_, i) => f((i / n) * TAU));
const sgnpow = (v, p) => Math.sign(v) * Math.abs(v) ** p;
const cutRect = (hw, hl, c) => [
  [hw - c, hl], [-(hw - c), hl], [-hw, hl - c], [-hw, -(hl - c)],
  [-(hw - c), -hl], [hw - c, -hl], [hw, -(hl - c)], [hw, hl - c],
];
const square = (hw, hl) => [[hw, hl], [-hw, hl], [-hw, -hl], [hw, -hl]];

// Curved-sided polygon: each edge bulges outward by `bulge` * edge length.
function curved(poly, bulge, steps = 8) {
  const out = [];
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const mx = (a[0] + b[0]) / 2 - cx, mz = (a[1] + b[1]) / 2 - cz;
    const ml = Math.hypot(mx, mz) || 1;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const bump = Math.sin(Math.PI * t) * bulge * len;
      out.push([a[0] + (b[0] - a[0]) * t + (mx / ml) * bump, a[1] + (b[1] - a[1]) * t + (mz / ml) * bump]);
    }
  }
  return out;
}

export const CUTS = {
  round: { aspect: 1, k: 0.00364, shape: (hw, hl, N) => ring(N, (a) => [Math.cos(a) * hw, Math.sin(a) * hl]) },
  oval: { aspect: 1.35, k: 0.004, shape: (hw, hl, N) => ring(N, (a) => [Math.cos(a) * hw, Math.sin(a) * hl]) },
  marquise: { aspect: 2, k: 0.004, shape: (hw, hl, N) => ring(N, (a) => [hw * Math.cos(a) * Math.abs(Math.cos(a)), Math.sin(a) * hl]) },
  pear: {
    aspect: 1.55,
    k: 0.0039,
    shape: (hw, hl, N) => ring(N, (a) => {
      const z = Math.sin(a) * hl;
      const t = (z + hl) / (2 * hl); // 0 at the tip
      return [Math.cos(a) * hw * (0.25 + 0.75 * Math.sqrt(Math.max(t, 0))), z];
    }),
  },
  heart: {
    aspect: 1,
    k: 0.0042,
    shape: (hw, hl, N) => ring(N, (a) => {
      const t = TAU - a; // wind so the outline is consistent with the others
      const x = 16 * Math.sin(t) ** 3;
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      return [(x / 16) * hw, ((y + 2.5) / 14.5) * hl]; // lobes at +z, point at -z
    }),
  },
  cushion: { aspect: 1, k: 0.006, shape: (hw, hl, N) => ring(N, (a) => [sgnpow(Math.cos(a), 2 / 3.2) * hw, sgnpow(Math.sin(a), 2 / 3.2) * hl]) },
  princess: { aspect: 1, k: 0.006, shape: (hw, hl) => square(hw, hl) },
  emerald: { aspect: 1.4, k: 0.0057, shape: (hw, hl) => cutRect(hw, hl, 0.2 * hw) },
  asscher: { aspect: 1, k: 0.006, shape: (hw, hl) => cutRect(hw, hl, 0.28 * hw) },
  radiant: { aspect: 1.2, k: 0.0058, shape: (hw, hl) => cutRect(hw, hl, 0.14 * hw) },
  baguette: { aspect: 2.2, k: 0.008, shape: (hw, hl) => square(hw, hl) },
  "tapered-baguette": { aspect: 2, k: 0.0075, shape: (hw, hl) => [[hw, hl], [-hw, hl], [-hw * 0.65, -hl], [hw * 0.65, -hl]] },
  trillion: { aspect: 0.87, k: 0.0046, shape: (hw, hl) => curved([[0, hl], [-hw, -hl], [hw, -hl]], 0.06) },
  hexagonal: { aspect: 1.155, k: 0.005, shape: (hw, hl) => [[hw, hl / 2], [0, hl], [-hw, hl / 2], [-hw, -hl / 2], [0, -hl], [hw, -hl / 2]] },
  octagonal: { aspect: 1, k: 0.0058, shape: (hw, hl) => cutRect(hw, hl, 0.29 * hw) },
};

export const MELEE_SIZES = [0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.0, 2.2, 2.5, 3.0];

export const caratOf = (cut, dia) => CUTS[cut].k * dia ** 3 * CUTS[cut].aspect;
export const isStockedMelee = (dia) => MELEE_SIZES.some((s) => Math.abs(s - dia) < 1e-6);

// True offset of a closed polygon by `off` mm (positive = outward): the
// outline grown by a disc. Convex corners get round joins (exactly `off` from
// the corner), concave corners a capped miter; loops are removed afterwards.
export function offsetPolygon(pts, off) {
  if (!off) return pts;
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) area += pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1];
  const sign = area > 0 ? 1 : -1; // outward normal side for this winding
  const normal = (a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    return [(sign * dz) / len, (-sign * dx) / len];
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n];
    const n1 = normal(prev, p), n2 = normal(p, next);
    // convex for this offset direction when the edge turns away from the offset side
    const turn = (p[0] - prev[0]) * (next[1] - p[1]) - (p[1] - prev[1]) * (next[0] - p[0]);
    const convex = turn * sign * Math.sign(off) > 0;
    const angle = Math.atan2(n1[0] * n2[1] - n1[1] * n2[0], n1[0] * n2[0] + n1[1] * n2[1]);
    if (convex && Math.abs(angle) > 0.15) {
      // round join: sweep from n1 to n2 around the corner
      const steps = Math.ceil(Math.abs(angle) / 0.2);
      const a0 = Math.atan2(n1[1], n1[0]);
      for (let k = 0; k <= steps; k++) {
        const t = a0 + (angle * k) / steps;
        out.push([p[0] + Math.cos(t) * off, p[1] + Math.sin(t) * off]);
      }
      continue;
    }
    let bx = n1[0] + n2[0], bz = n1[1] + n2[1];
    const bl = Math.hypot(bx, bz);
    if (bl < 1e-9) {
      out.push([p[0] + n1[0] * off, p[1] + n1[1] * off]);
      continue;
    }
    bx /= bl;
    bz /= bl;
    const cosHalf = Math.max(0.5, bx * n1[0] + bz * n1[1]);
    out.push([p[0] + (bx * off) / cosHalf, p[1] + (bz * off) / cosHalf]);
  }
  return out;
}

// Cut out the small loops an offset makes at concave corners (the heart's
// notch), leaving a simple polygon.
export function removeLoops(pts) {
  const cross = (a, b, c, d) => {
    const r = [b[0] - a[0], b[1] - a[1]], q = [d[0] - c[0], d[1] - c[1]];
    const den = r[0] * q[1] - r[1] * q[0];
    if (Math.abs(den) < 1e-12) return null;
    const t = ((c[0] - a[0]) * q[1] - (c[1] - a[1]) * q[0]) / den;
    const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
    return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9 ? [a[0] + r[0] * t, a[1] + r[1] * t] : null;
  };
  let poly = pts.slice();
  for (let guard = 0; guard < 50; guard++) {
    const n = poly.length;
    let found = false;
    for (let i = 0; i < n && !found; i++) {
      // a loop is short: only look a quarter of the way round
      for (let k = 2; k < Math.min(n - 1, Math.ceil(n / 4)) && !found; k++) {
        const j = (i + k) % n;
        const x = cross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n]);
        if (!x) continue;
        // drop vertices i+1..j, replace with the crossing point
        const keep = [];
        for (let m = 0; m < n; m++) {
          const inLoop = ((m - i - 1 + n) % n) < k;
          if (!inLoop) keep.push(poly[m]);
          if (m === i) keep.push(x);
        }
        poly = keep;
        found = true;
      }
    }
    if (!found) break;
  }
  return poly;
}

// Closed girdle outline in the xz plane, offset by `off` mm on every side.
// N is the sample count for smooth cuts; polygon cuts ignore it.
export function outline(cut, dia, off = 0, N = 360) {
  const c = CUTS[cut];
  const base = c.shape(dia / 2, (dia * c.aspect) / 2, N);
  return off ? removeLoops(offsetPolygon(base, off)) : base;
}

// Girdle plane at y = 0, table up (+y), culet down. Proportions follow a
// standard brilliant: table 57%, crown 16%, pavilion 43%, girdle 3%.
export function stoneGeometry(cut, dia) {
  const pts = outline(cut, dia, 0, 48);
  const n = pts.length;
  const g = 0.03 * dia;
  const crown = 0.16 * dia;
  const pav = 0.43 * dia;
  const pos = [];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  const lo = pts.map(([x, z]) => [x, -g / 2, z]);
  const up = pts.map(([x, z]) => [x, g / 2, z]);
  const tab = pts.map(([x, z]) => [x * 0.57, g / 2 + crown, z * 0.57]);
  const culet = [0, -pav, 0];
  const top = [0, g / 2 + crown, 0];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tri(lo[i], lo[j], culet);
    tri(lo[j], lo[i], up[i]);
    tri(lo[j], up[i], up[j]);
    tri(up[j], up[i], tab[i]);
    tri(up[j], tab[i], tab[j]);
    tri(tab[j], tab[i], top);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return fixWinding(geo);
}

// Evenly spaced points along a closed polyline, spacing >= minPitch.
export function spaceAlong(poly, minPitch) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push({ a, b, len, start: total });
    total += len;
  }
  const n = Math.max(1, Math.floor(total / minPitch));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const d = (i / n) * total;
    const s = segs.find((q) => d >= q.start && d < q.start + q.len) || segs[segs.length - 1];
    const t = s.len ? (d - s.start) / s.len : 0;
    pts.push([s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t]);
  }
  return { pts, perimeter: total, pitch: total / n };
}
