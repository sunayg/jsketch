// Geometry helpers shared by the builders and the checks.
import * as THREE from "three";

export function signedVolume(geo) {
  const p = geo.attributes.position;
  const idx = geo.index;
  const n = idx ? idx.count : p.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let v = 0;
  for (let i = 0; i < n; i += 3) {
    const [i0, i1, i2] = idx ? [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)] : [i, i + 1, i + 2];
    a.fromBufferAttribute(p, i0);
    b.fromBufferAttribute(p, i1);
    c.fromBufferAttribute(p, i2);
    v += a.dot(b.cross(c)) / 6;
  }
  return v;
}

// Make triangle winding outward (positive volume) so exports are sane.
export function fixWinding(geo) {
  if (signedVolume(geo) >= 0) return geo;
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i += 3) {
    const [x, y, z] = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)];
    p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
    p.setXYZ(i + 2, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

// Count edges used by only one triangle (after welding vertices). 0 means closed.
export function openEdges(geo) {
  const p = geo.attributes.position;
  const idx = geo.index;
  const n = idx ? idx.count : p.count;
  const weld = new Map();
  const id = (i) => {
    // integer keys at 1 µm: welds seam vertices that differ by float noise
    const q = (v) => Math.round(v * 1e3) || 0;
    const k = `${q(p.getX(i))},${q(p.getY(i))},${q(p.getZ(i))}`;
    let v = weld.get(k);
    if (v === undefined) weld.set(k, (v = weld.size));
    return v;
  };
  const edges = new Map();
  const add = (a, b) => {
    if (a === b) return;
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    edges.set(key, (edges.get(key) || 0) + 1);
  };
  for (let t = 0; t < n; t += 3) {
    const [i0, i1, i2] = idx ? [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)] : [t, t + 1, t + 2];
    const [a, b, c] = [id(i0), id(i1), id(i2)];
    add(a, b);
    add(b, c);
    add(c, a);
  }
  let open = 0;
  for (const count of edges.values()) if (count % 2 === 1) open++;
  return open;
}

// Normals for display of a triangle soup: averaged across triangles that
// share a vertex position, except across sharp edges (crease, degrees), so
// smooth sculpts don't look faceted and real edges stay crisp.
export function smoothNormals(geometry, crease = 50) {
  const p = geometry.attributes.position.array;
  const n = p.length / 9;
  const fn = new Float32Array(n * 3);
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const ux = p[o + 3] - p[o], uy = p[o + 4] - p[o + 1], uz = p[o + 5] - p[o + 2];
    const vx = p[o + 6] - p[o], vy = p[o + 7] - p[o + 1], vz = p[o + 8] - p[o + 2];
    // area-weighted (not normalised)
    fn[t * 3] = uy * vz - uz * vy;
    fn[t * 3 + 1] = uz * vx - ux * vz;
    fn[t * 3 + 2] = ux * vy - uy * vx;
  }
  const groups = new Map();
  const q = (v) => Math.round(v * 1e4);
  for (let v = 0; v < n * 3; v++) {
    const key = `${q(p[v * 3])},${q(p[v * 3 + 1])},${q(p[v * 3 + 2])}`;
    const g = groups.get(key);
    if (g) g.push(v);
    else groups.set(key, [v]);
  }
  const cos = Math.cos((crease * Math.PI) / 180);
  const out = new Float32Array(n * 9);
  const unit = (t) => {
    const x = fn[t * 3], y = fn[t * 3 + 1], z = fn[t * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  };
  for (const g of groups.values()) {
    for (const v of g) {
      const a = unit(Math.floor(v / 3));
      let sx = 0, sy = 0, sz = 0;
      for (const w of g) {
        const t = Math.floor(w / 3);
        const b = unit(t);
        if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < cos) continue;
        sx += fn[t * 3];
        sy += fn[t * 3 + 1];
        sz += fn[t * 3 + 2];
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      out[v * 3] = sx / l;
      out[v * 3 + 1] = sy / l;
      out[v * 3 + 2] = sz / l;
    }
  }
  geometry.setAttribute("normal", new THREE.BufferAttribute(out, 3));
  return geometry;
}
