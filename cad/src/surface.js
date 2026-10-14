// Spatial queries on a triangle mesh (a prepared sculpt): closest point,
// ray hits, and wall thickness. A uniform grid keeps queries local.
import * as THREE from "three";

export class TriGrid {
  // cell: grid spacing in mm; by default about three triangle edges, so a
  // cell holds a handful of triangles
  constructor(geometry, cell = null) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = (this.p = g.attributes.position.array);
    this.n = p.length / 9;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let edge = 0;
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
      if (p[i + k] < min[k]) min[k] = p[i + k];
      if (p[i + k] > max[k]) max[k] = p[i + k];
    }
    for (let t = 0; t < this.n; t += Math.max(1, Math.floor(this.n / 2000))) {
      const o = t * 9;
      edge = Math.max(edge * 0.98, 0) + 0.02 * Math.hypot(p[o + 3] - p[o], p[o + 4] - p[o + 1], p[o + 5] - p[o + 2]);
    }
    const big = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-6);
    cell ??= Math.min(1, Math.max(0.25, 3 * edge));
    // keep the grid bounded for very large meshes (a sculpt in the wrong units)
    cell = Math.max(cell, big / 200);
    this.cell = cell;
    this.min = min.map((v) => v - cell);
    this.dims = [0, 1, 2].map((k) => Math.ceil((max[k] - this.min[k]) / cell) + 2);
    this.normals = new Float32Array(this.n * 3);
    this.cells = new Map();
    this.stamp = new Int32Array(this.n);
    this.query = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3();
    for (let t = 0; t < this.n; t++) {
      this.tri(t, a, b, c);
      const nrm = ab.subVectors(b, a).cross(ac.subVectors(c, a));
      const len = nrm.length() || 1;
      this.normals[t * 3] = nrm.x / len;
      this.normals[t * 3 + 1] = nrm.y / len;
      this.normals[t * 3 + 2] = nrm.z / len;
      const lo = this.ijk(Math.min(a.x, b.x, c.x), Math.min(a.y, b.y, c.y), Math.min(a.z, b.z, c.z));
      const hi = this.ijk(Math.max(a.x, b.x, c.x), Math.max(a.y, b.y, c.y), Math.max(a.z, b.z, c.z));
      for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) {
        const key = this.key(i, j, k);
        const list = this.cells.get(key);
        if (list) list.push(t);
        else this.cells.set(key, [t]);
      }
    }
  }
  ijk(x, y, z) {
    const [nx, ny, nz] = this.dims;
    const c = (v, k, n) => Math.min(n - 1, Math.max(0, Math.floor((v - this.min[k]) / this.cell)));
    return [c(x, 0, nx), c(y, 1, ny), c(z, 2, nz)];
  }
  key(i, j, k) {
    return i + this.dims[0] * (j + this.dims[1] * k);
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
  // triangle ids whose cells touch the sphere (p, r), each once
  near(p, r) {
    const out = [];
    const q = ++this.query;
    const lo = this.ijk(p.x - r, p.y - r, p.z - r), hi = this.ijk(p.x + r, p.y + r, p.z + r);
    for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) {
      const list = this.cells.get(this.key(i, j, k));
      if (list) for (const t of list) if (this.stamp[t] !== q) {
        this.stamp[t] = q;
        out.push(t);
      }
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
    // walk the grid cells along the ray (Amanatides & Woo)
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const q = ++this.query;
    const h = this.cell, [nx, ny, nz] = this.dims;
    const o = [origin.x, origin.y, origin.z], d = [dir.x, dir.y, dir.z];
    const cellOf = this.ijk(o[0], o[1], o[2]);
    const step = d.map((v) => (v > 0 ? 1 : v < 0 ? -1 : 0));
    const tMax = d.map((v, k) => {
      if (!v) return Infinity;
      const edge = this.min[k] + (cellOf[k] + (v > 0 ? 1 : 0)) * h;
      return (edge - o[k]) / v;
    });
    const tDelta = d.map((v) => (v ? h / Math.abs(v) : Infinity));
    let best = Infinity;
    let [i, j, k] = cellOf;
    for (let t0 = 0; t0 <= maxDist; ) {
      const list = this.cells.get(this.key(i, j, k));
      if (list) for (const t of list) {
        if (this.stamp[t] === q) continue;
        this.stamp[t] = q;
        this.tri(t, a, b, c);
        const dist = rayTri(o, d, a, b, c);
        if (dist === null || dist <= skip || dist >= best) continue;
        if (fromInside && this.normals[t * 3] * d[0] + this.normals[t * 3 + 1] * d[1] + this.normals[t * 3 + 2] * d[2] < 0.2) continue;
        best = dist;
      }
      // next cell
      const ax = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
      t0 = tMax[ax];
      if (best <= t0) break; // nothing in later cells can be nearer
      tMax[ax] += tDelta[ax];
      if (ax === 0) i += step[0];
      else if (ax === 1) j += step[1];
      else k += step[2];
      if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) break;
    }
    return best <= maxDist ? best : null;
  }
}

// Möller–Trumbore, both faces; distance along a unit direction, or null.
function rayTri(o, d, a, b, c) {
  const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z;
  const e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z;
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const tx = o[0] - a.x, ty = o[1] - a.y, tz = o[2] - a.z;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return null;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (v < 0 || u + v > 1) return null;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
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
