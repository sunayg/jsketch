// Spatial queries on a triangle mesh (a prepared sculpt): closest point,
// ray hits, and wall thickness. A uniform grid keeps queries local.
import * as THREE from "three";

export class TriGrid {
  constructor(geometry, cell = 1) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    this.p = g.attributes.position.array;
    this.n = this.p.length / 9;
    this.cell = cell;
    this.normals = new Float32Array(this.n * 3);
    this.cells = new Map();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < this.n; t++) {
      this.tri(t, a, b, c);
      const nrm = b.clone().sub(a).cross(c.clone().sub(a));
      const len = nrm.length() || 1;
      this.normals.set([nrm.x / len, nrm.y / len, nrm.z / len], t * 3);
      const lo = [Math.min(a.x, b.x, c.x), Math.min(a.y, b.y, c.y), Math.min(a.z, b.z, c.z)].map((v) => Math.floor(v / cell));
      const hi = [Math.max(a.x, b.x, c.x), Math.max(a.y, b.y, c.y), Math.max(a.z, b.z, c.z)].map((v) => Math.floor(v / cell));
      for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) {
        const key = `${i},${j},${k}`;
        (this.cells.get(key) || this.cells.set(key, []).get(key)).push(t);
      }
    }
  }
  tri(t, a, b, c) {
    const p = this.p, o = t * 9;
    a.set(p[o], p[o + 1], p[o + 2]);
    b.set(p[o + 3], p[o + 4], p[o + 5]);
    c.set(p[o + 6], p[o + 7], p[o + 8]);
  }
  normal(t) {
    return new THREE.Vector3(this.normals[t * 3], this.normals[t * 3 + 1], this.normals[t * 3 + 2]);
  }
  // triangle ids whose cells touch the sphere (p, r)
  near(p, r) {
    const out = new Set();
    const lo = [p.x - r, p.y - r, p.z - r].map((v) => Math.floor(v / this.cell));
    const hi = [p.x + r, p.y + r, p.z + r].map((v) => Math.floor(v / this.cell));
    for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) {
      for (const t of this.cells.get(`${i},${j},${k}`) || []) out.add(t);
    }
    return out;
  }
  closestPoint(p, maxDist = 2) {
    const tri = new THREE.Triangle();
    const q = new THREE.Vector3();
    let best = null;
    for (const t of this.near(p, maxDist)) {
      this.tri(t, tri.a, tri.b, tri.c);
      tri.closestPointToPoint(p, q);
      const d = q.distanceTo(p);
      if (d <= maxDist && (!best || d < best.dist)) best = { point: q.clone(), dist: d, tri: t };
    }
    return best;
  }
  // area-weighted normal of the surface within radius r of p (smooth normal)
  smoothNormal(p, r) {
    const n = new THREE.Vector3();
    const tri = new THREE.Triangle();
    for (const t of this.near(p, r)) {
      this.tri(t, tri.a, tri.b, tri.c);
      const cen = tri.getMidpoint(new THREE.Vector3());
      if (cen.distanceTo(p) > r) continue;
      n.addScaledVector(this.normal(t), tri.getArea());
    }
    return n.lengthSq() ? n.normalize() : null;
  }
  // nearest hit along a ray, skipping hits closer than `skip`. With
  // fromInside, only hits on a wall facing along the ray count (the far side
  // of the solid), so grazing a neighbouring face in a crease is ignored.
  raycast(origin, dir, maxDist = 10, skip = 0.01, fromInside = false) {
    const ray = new THREE.Ray(origin, dir);
    const tri = new THREE.Triangle();
    const hit = new THREE.Vector3();
    const seen = new Set();
    let best = Infinity;
    const steps = Math.ceil(maxDist / (this.cell * 0.5));
    for (let s = 0; s <= steps; s++) {
      const at = origin.clone().addScaledVector(dir, (s * maxDist) / steps);
      for (const t of this.near(at, this.cell * 0.5)) {
        if (seen.has(t)) continue;
        seen.add(t);
        this.tri(t, tri.a, tri.b, tri.c);
        if (ray.intersectTriangle(tri.a, tri.b, tri.c, false, hit)) {
          if (fromInside && this.normal(t).dot(dir) < 0.2) continue;
          const d = hit.distanceTo(origin);
          if (d > skip && d < best) best = d;
        }
      }
      if (best < (s * maxDist) / steps - this.cell) break;
    }
    return best <= maxDist ? best : null;
  }
}

// Wall thickness at every vertex: distance inward (against the normal) to the
// opposite surface. Returns per-vertex values (non-indexed order) and the
// thinnest spot.
export function wallThickness(geometry, grid = new TriGrid(geometry)) {
  const p = grid.p;
  const out = new Float32Array(p.length / 3);
  let min = { mm: Infinity, at: [0, 0, 0] };
  const cache = new Map();
  for (let v = 0; v < out.length; v++) {
    const t = Math.floor(v / 3);
    const key = `${p[v * 3].toFixed(3)},${p[v * 3 + 1].toFixed(3)},${p[v * 3 + 2].toFixed(3)}`;
    let d = cache.get(key);
    if (d === undefined) {
      const origin = new THREE.Vector3(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
      const n = grid.smoothNormal(origin, 0.4) || grid.normal(t);
      const shoot = (dir) => grid.raycast(origin.clone().addScaledVector(n, -0.005), dir, 8, 0.005, true) ?? 8;
      d = shoot(n.clone().negate());
      // a short reading is confirmed with a small cone of rays (median), so a
      // crease or a single odd triangle can't fake a thin wall
      if (d < 2) {
        const u = new THREE.Vector3(1, 0, 0).cross(n);
        if (u.lengthSq() < 1e-6) u.set(0, 1, 0).cross(n);
        u.normalize();
        const w = n.clone().cross(u);
        const tilt = Math.tan((15 * Math.PI) / 180);
        const reads = [d, ...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => shoot(n.clone().negate().addScaledVector(u, a * tilt).addScaledVector(w, b * tilt).normalize()) * Math.cos((15 * Math.PI) / 180))];
        reads.sort((a, b) => a - b);
        d = reads[2];
      }
      cache.set(key, d);
      if (d < min.mm) min = { mm: d, at: [origin.x, origin.y, origin.z] };
    }
    out[v] = d;
  }
  return { perVertex: out, min };
}
