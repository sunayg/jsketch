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

// Closed girdle outline in the xz plane, widened by `off` mm on every side.
// N is the sample count for smooth cuts; polygon cuts ignore it.
export function outline(cut, dia, off = 0, N = 360) {
  const c = CUTS[cut];
  return c.shape(dia / 2 + off, (dia * c.aspect) / 2 + off, N);
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
