// Compile a design into plain data: metal geometries (world space, mm) and a
// stone list. No DOM or renderer needed, so the CLI and tests use it too.
import * as THREE from "three";
import { parseSize } from "./sizes.js";
import { CUTS, MELEE_SIZES, outline, spaceAlong } from "./gems.js";

const UP = new THREE.Vector3(0, 1, 0);

// World transform of a stone: girdle centre at pos, table facing along normal.
export const stoneMatrix = (s) =>
  new THREE.Matrix4().compose(s.pos, new THREE.Quaternion().setFromUnitVectors(UP, s.normal), new THREE.Vector3(1, 1, 1));
const TAU = Math.PI * 2;

// Cross-section of the shank in (radius, axial) coordinates.
function shankProfile(ri, ro, w, kind) {
  const h = w / 2;
  if (kind === "flat") return [[ri, -h], [ro, -h], [ro, h], [ri, h], [ri, -h]];
  if (kind === "comfort") {
    const c = Math.min(0.5, (ro - ri) / 3, w / 4);
    return [[ri + c, -h], [ro, -h], [ro, h], [ri + c, h], [ri, h - c], [ri, -h + c], [ri + c, -h]];
  }
  // domed: outer surface bulges
  const pts = [[ri, -h]];
  const dome = Math.min(0.4 * (ro - ri), 0.6);
  pts.push([ro - dome, -h]);
  for (let i = 1; i < 8; i++) {
    const y = -h + (w * i) / 8;
    pts.push([ro - dome * (1 - (1 - Math.pow((2 * y) / w, 2))), y]);
  }
  pts.push([ro - dome, h], [ri, h], [ri, -h]);
  return pts;
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

function rod(a, b, r) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, dir.length(), 12, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()));
  const mid = a.clone().add(b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

// Hex lattice in (arc length s, axial w) on the shank's outer surface.
function paveStones(d, geom, dia) {
  const { ro, width, circumference } = geom;
  const { gap } = d.pave;
  const pitch = dia + gap;
  const rowH = pitch * Math.sqrt(3) / 2;
  const centre = new THREE.Vector3(0, ro, 0);
  const headR = d.stone.dia * 0.3 + dia / 2 + 0.3;
  const wrap = (s) => ((s % circumference) + circumference) % circumference;
  const dist = (a, b) => {
    const ds = Math.abs(wrap(a - b + circumference / 2) - circumference / 2);
    return Math.hypot(ds, 0); // arc distance only; axial added by caller
  };
  const out = [];
  if (!d.paint.length) return out;
  const rows = Math.floor((width / 2 - dia / 2 - 0.1) / rowH);
  for (let j = -rows; j <= rows; j++) {
    const w = j * rowH;
    const offset = (j & 1) * pitch / 2;
    const count = Math.floor(circumference / pitch);
    const step = circumference / count; // closes the ring evenly
    for (let k = 0; k < count; k++) {
      const s = k * step + offset * (step / pitch);
      const painted = d.paint.some((p) => Math.hypot(dist(s, p.s), w - p.w) <= p.r);
      if (!painted) continue;
      const th = s / ro;
      const n = new THREE.Vector3(Math.sin(th), Math.cos(th), 0);
      const pos = n.clone().multiplyScalar(ro - 0.05).add(new THREE.Vector3(0, 0, w));
      if (pos.distanceTo(centre) < headR) continue; // keep clear of the head
      out.push({ cut: "round", dia, role: "pave", pos, normal: n });
    }
  }
  return out;
}

// Auto size: among stocked melee sizes in [min, max], pick the one that covers
// the most painted area (stones * dia^2); ties go to the larger stone.
function autoPave(d, geom) {
  const lo = d.pave.min ?? 0.9;
  const hi = d.pave.max ?? 2;
  let best = null;
  for (const dia of MELEE_SIZES.filter((x) => x >= lo - 1e-9 && x <= hi + 1e-9)) {
    const stones = paveStones(d, geom, dia);
    const covered = stones.length * dia * dia;
    if (!best || covered > best.covered + 1e-9 || (Math.abs(covered - best.covered) <= 1e-9 && dia > best.dia)) {
      best = { dia, stones, covered };
    }
  }
  return best;
}

const QUALITY = { draft: 64, standard: 160, fine: 320 };

export function build(d, { quality = "standard" } = {}) {
  const size = parseSize(d.ring.size);
  const diameter = d.ring.diameter ?? size.innerDiameter;
  const ri = diameter / 2;
  const seg = QUALITY[quality] ?? QUALITY.standard;
  const t = d.shank.thickness;
  const ro = ri + t;
  const w = d.shank.width;
  const metal = [];
  const stones = [];

  // shank: revolve profile around Z, then stand the ring up
  const lathe = new THREE.LatheGeometry(
    shankProfile(ri, ro, w, d.shank.profile).map(([r, y]) => new THREE.Vector2(r, y)),
    seg,
  );
  lathe.rotateX(Math.PI / 2);
  metal.push({ name: "shank", geometry: fixWinding(lathe) });

  // centre stone and its setting
  const dia = d.stone.dia;
  const cut = CUTS[d.stone.cut];
  const pavDepth = 0.43 * dia;
  const girdleY = ro + 0.5 + pavDepth;
  const centre = new THREE.Vector3(0, girdleY, 0);
  stones.push({ cut: d.stone.cut, dia, role: "centre", pos: centre, normal: UP.clone() });

  const halfW = dia / 2;
  const halfL = (dia * cut.aspect) / 2;
  if (d.stone.setting === "prong") {
    const n = d.stone.prongs;
    const pr = Math.max(0.4, Math.min(0.6, dia * 0.07)); // prong radius: 0.8-1.2 mm wire
    const ring = outline(d.stone.cut, dia, pr * 0.6);
    const pts = spaceAlong(ring, 1).pts; // sample outline, pick n points
    for (let i = 0; i < n; i++) {
      const [x, z] = pts[Math.floor(((i + 0.5) / n) * pts.length) % pts.length];
      const top = new THREE.Vector3(x, girdleY + 0.1, z);
      const base = new THREE.Vector3(x * 0.35, ro - 0.3, z * 0.35);
      metal.push({ name: `prong${i + 1}`, geometry: fixWinding(rod(base, top, pr)), thickness: pr * 2 });
      const tip = new THREE.SphereGeometry(pr * 1.05, 12, 8);
      tip.translate(x * 0.97, girdleY + 0.25, z * 0.97);
      metal.push({ name: `tip${i + 1}`, geometry: fixWinding(tip) });
    }
    const wire = Math.max(0.45, pr * 0.8); // gallery wire radius
    const gallery = new THREE.TorusGeometry(Math.max(halfW, halfL) * 0.5, wire, 8, 40);
    gallery.rotateX(Math.PI / 2);
    gallery.scale(halfW / Math.max(halfW, halfL), 1, halfL / Math.max(halfW, halfL));
    gallery.translate(0, ro + pavDepth * 0.35, 0);
    metal.push({ name: "gallery", geometry: fixWinding(gallery), thickness: wire * 2 });
  } else {
    // bezel: a thin collar following the girdle outline
    const wall = 0.5;
    const o = outline(d.stone.cut, dia, wall);
    const shape = new THREE.Shape(o.map(([x, z]) => new THREE.Vector2(x, z)));
    const inner = new THREE.Path(outline(d.stone.cut, dia, -0.02).map(([x, z]) => new THREE.Vector2(x, z)).reverse());
    shape.holes.push(inner);
    const h = pavDepth * 0.6 + 0.3;
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 1 });
    g.rotateX(-Math.PI / 2); // extrude axis -> +y, outline in xz
    g.translate(0, girdleY - h + 0.3, 0);
    metal.push({ name: "bezel", geometry: fixWinding(g), thickness: wall });
    const base = new THREE.CylinderGeometry(halfW * 0.7, halfW * 0.5, ro + 0.3 - (ro - 0.3) + 0.2, 20);
    base.translate(0, ro + 0.05, 0);
    metal.push({ name: "seat", geometry: fixWinding(base) });
  }

  // halo follows the cut's girdle outline
  if (d.halo) {
    const { dia: hd, gap } = d.halo;
    const off = gap + hd / 2 + (d.stone.setting === "bezel" ? 0.5 : 0);
    const { pts } = spaceAlong(outline(d.stone.cut, dia, off), hd + gap);
    for (const [x, z] of pts) {
      stones.push({ cut: "round", dia: hd, role: "halo", pos: new THREE.Vector3(x, girdleY - 0.15, z), normal: UP.clone() });
    }
    const plateT = Math.max(0.8, d.rule.min_wall); // plate follows the minimum wall
    const plate = new THREE.CylinderGeometry(Math.max(halfW, halfL) + off + hd * 0.4, halfW * 0.6, plateT, 40);
    plate.translate(0, girdleY - 0.15 - hd * 0.43 - plateT / 2 + 0.05, 0);
    metal.push({ name: "halo-plate", geometry: fixWinding(plate), thickness: plateT });
  }

  const geom = { ri, ro, width: w, circumference: TAU * ro, innerDiameter: diameter };
  let paveDia = d.pave.dia;
  if (d.pave.dia === "auto") {
    const best = d.paint.length ? autoPave(d, geom) : null;
    paveDia = best ? best.dia : null;
    if (best) stones.push(...best.stones);
  } else {
    stones.push(...paveStones(d, geom, d.pave.dia));
  }
  return { metal, stones, geom, design: d, paveDia };
}
