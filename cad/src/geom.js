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
    // integer keys: avoids "-0.0000" vs "0.0000" at seams
    const q = (v) => Math.round(v * 1e4) || 0;
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
