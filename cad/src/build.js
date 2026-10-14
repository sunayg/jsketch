// Compile a design into plain data: metal geometries (world space, mm) and a
// stone list. No DOM or renderer needed, so the CLI and tests use it too.
//
// Frame: the finger axis is Z, the head sits at +Y. A point on the band is
// addressed by (s, w): s = arc length along the outer surface from the top
// (positive towards +X), w = position across the band along Z.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { parseSize } from "./sizes.js";
import { CUTS, MELEE_SIZES, outline, spaceAlong } from "./gems.js";
import { fixWinding, signedVolume } from "./geom.js";
import { TriGrid } from "./surface.js";
import { hitsMetal } from "./clearance.js";

export { fixWinding, signedVolume };

const UP = new THREE.Vector3(0, 1, 0);

// A prepared sculpt depends on its file and every option except its id.
export const sculptKey = (sc) => JSON.stringify(Object.entries(sc).filter(([k]) => k !== "id" && k !== "exprs").sort());
const TAU = Math.PI * 2;
const QUALITY = { draft: 64, standard: 160, fine: 320 };
// metal left between a band-set stone and the band edge
export const EDGE = 0.25;

// World transform of a stone: girdle centre at pos, table facing along normal.
// `turn` (degrees) spins the stone about its own axis (e.g. to aim a pear).
export const stoneMatrix = (s) => {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, s.normal);
  if (s.turn) q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, (s.turn * Math.PI) / 180));
  return new THREE.Matrix4().compose(s.pos, q, new THREE.Vector3(1, 1, 1));
};

// Split long profile edges so the band has vertices across its faces (the
// wall-thickness heatmap colours per vertex).
function subdivide(pts, step = 0.25) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

// Cross-section of the shank in (radius, axial) coordinates.
function shankProfile(ri, ro, w, kind) {
  const h = w / 2;
  if (kind === "flat") return [[ri, -h], [ro, -h], [ro, h], [ri, h], [ri, -h]];
  if (kind === "comfort") {
    const c = comfortChamfer(ri, ro, w);
    return [[ri + c, -h], [ro, -h], [ro, h], [ri + c, h], [ri, h - c], [ri, -h + c], [ri + c, -h]];
  }
  const dome = domeHeight(ri, ro);
  const pts = [[ri, -h], [ro - dome, -h]];
  for (let i = 1; i < 8; i++) {
    const y = -h + (w * i) / 8;
    pts.push([ro - dome * ((2 * y) / w) ** 2, y]);
  }
  pts.push([ro - dome, h], [ri, h], [ri, -h]);
  return pts;
}
const comfortChamfer = (ri, ro, w) => Math.min(0.5, (ro - ri) / 3, w / 4);
const domeHeight = (ri, ro) => Math.min(0.4 * (ro - ri), 0.6);

// Wall thickness of the shank at axial position w (used by checks and the heatmap).
export function shankThicknessAt(d, geom, w) {
  if (d.shank.profile === "none") return Infinity;
  const { ri, ro, width } = geom;
  const h = width / 2;
  const t = ro - ri;
  if (d.shank.profile === "comfort") {
    const c = comfortChamfer(ri, ro, width);
    const edge = Math.abs(w) - (h - c); // > 0 inside the chamfer band
    return edge > 0 ? t - Math.min(c, edge) : t;
  }
  if (d.shank.profile === "domed") return t - domeHeight(ri, ro) * ((2 * w) / width) ** 2;
  return t;
}

// Outer radius at axial w (domed bands drop toward the edges).
const outerAt = (d, geom, w) =>
  d.shank.profile === "domed" ? geom.ro - domeHeight(geom.ri, geom.ro) * ((2 * w) / geom.width) ** 2 : geom.ro;

// Point and outward normal on the band's outer surface.
export function surfaceAt(d, geom, s, w, lift = 0) {
  const th = s / geom.ro;
  const n = new THREE.Vector3(Math.sin(th), Math.cos(th), 0);
  const pos = n.clone().multiplyScalar(outerAt(d, geom, w) + lift).add(new THREE.Vector3(0, 0, w));
  return { pos, normal: n };
}

function rod(a, b, r, radial = 12) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, Math.max(dir.length(), 1e-4), radial, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()));
  const mid = a.clone().add(b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

const merged = (geos) => (geos.length ? fixWinding(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => (g.deleteAttribute("uv"), g)))) : null);

// ---- heads (built in a local frame: stone axis +y, girdle at girdleY) ----

function tipGeometry(kind, pr, at, inward) {
  let g;
  if (kind === "pointed") {
    g = new THREE.ConeGeometry(pr * 1.05, pr * 2.4, 12);
    g.translate(0, pr * 0.9, 0);
  } else if (kind === "flat") {
    g = new THREE.CylinderGeometry(pr * 1.05, pr * 1.05, pr * 0.9, 12);
  } else if (kind === "claw") {
    g = new THREE.SphereGeometry(pr * 1.1, 12, 8);
    g.scale(1.25, 0.7, 1.25);
    g.translate(inward.x * pr * 0.35, 0, inward.z * pr * 0.35);
  } else {
    g = new THREE.SphereGeometry(pr * 1.05, 12, 8);
  }
  g.translate(at.x, at.y, at.z);
  return g;
}

// Flat ring between two outline offsets, top face at topY.
function annulus(cut, dia, inOff, outOff, height, topY) {
  const shape = new THREE.Shape(outline(cut, dia, outOff, 96).map(([x, z]) => new THREE.Vector2(x, z)));
  shape.holes.push(new THREE.Path(outline(cut, dia, inOff, 96).map(([x, z]) => new THREE.Vector2(x, z)).reverse()));
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, topY - height, 0);
  return g;
}

// Solid plate following the outline (offset by `off`), top face at topY.
function annulusSolid(cut, dia, off, height, topY) {
  const shape = new THREE.Shape(outline(cut, dia, off, 96).map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, topY - height, 0);
  return g;
}

function collar(cut, dia, wall, height, topY) {
  const shape = new THREE.Shape(outline(cut, dia, wall).map(([x, z]) => new THREE.Vector2(x, z)));
  shape.holes.push(new THREE.Path(outline(cut, dia, -0.02).map(([x, z]) => new THREE.Vector2(x, z)).reverse()));
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2); // extrude axis -> +y, outline in xz
  g.translate(0, topY - height, 0);
  return g;
}

// Prong wire radius for a stone width: 0.8-1.2 mm wire.
export const prongRadius = (dia) => Math.max(0.4, Math.min(0.6, dia * 0.07));
// How far prongs reach outside the girdle (prong offset + tip radius).
const prongReach = (dia) => prongRadius(dia) * 1.7;

// Returns metal parts in the local frame for a stone of `cut`/`dia` whose
// girdle sits at girdleY, with metal starting at baseY. parts.colliders holds
// simple shapes (capsules) of the prongs, used by the stone-clearance check.
function headParts({ cut, dia, setting, prongs = 4, tip = "round", baseY, girdleY, minWall }) {
  // an outline-shaped block of metal, for the stone-clearance check
  const prism = (off, y0, y1) => parts.colliders.push({ type: "prism", poly: outline(cut, dia, off, 32), y0, y1 });
  const parts = [];
  parts.colliders = [];
  const pav = 0.43 * dia;
  const aspect = CUTS[cut].aspect;
  const halfW = dia / 2;
  const halfL = (dia * aspect) / 2;
  const prongSet = (n, pr) => {
    const pts = spaceAlong(outline(cut, dia, pr * 0.6), Math.min(1, dia / 8)).pts;
    for (let i = 0; i < n; i++) {
      const [x, z] = pts[Math.floor(((i + 0.5) / n) * pts.length) % pts.length];
      const top = new THREE.Vector3(x, girdleY + 0.1, z);
      const base = new THREE.Vector3(x * 0.35, baseY, z * 0.35);
      parts.push({ name: `prong${i + 1}`, geometry: rod(base, top, pr), thickness: pr * 2 });
      const inward = new THREE.Vector3(-x, 0, -z).normalize();
      const tipAt = new THREE.Vector3(x * 0.97, girdleY + 0.25, z * 0.97);
      parts.push({ name: `tip${i + 1}`, geometry: tipGeometry(tip, pr, tipAt, inward) });
      parts.colliders.push({ a: base, b: top, r: pr }, { a: tipAt, b: tipAt, r: pr * 1.05 });
    }
  };
  if (setting === "prong") {
    const pr = prongRadius(dia);
    prongSet(prongs, pr);
    const wire = Math.max(0.45, pr * 0.8);
    const m = Math.max(halfW, halfL);
    const gallery = new THREE.TorusGeometry(m * 0.5, wire, 8, 40);
    gallery.rotateX(Math.PI / 2);
    gallery.scale(halfW / m, 1, halfL / m);
    gallery.translate(0, baseY + 0.3 + pav * 0.35, 0);
    parts.push({ name: "gallery", geometry: gallery, thickness: wire * 2 });
  } else if (setting === "bezel") {
    // collar from just above the girdle down to a seat that stops under the
    // culet, so the bezel is one piece with the band and the stone sits free
    const wall = Math.max(0.5, minWall);
    const seatTop = girdleY - pav - 0.05;
    const hasSeat = seatTop - baseY >= 0.3;
    const bottom = hasSeat ? seatTop - 0.1 : baseY;
    parts.push({ name: "bezel", geometry: collar(cut, dia, wall, girdleY + 0.3 - bottom, girdleY + 0.3), thickness: wall });
    prism(wall, baseY, girdleY + 0.3);
    if (hasSeat) {
      // a column down into the band, capped by a plate under the culet that
      // reaches out under the collar so the bezel is one piece with the band
      const seat = new THREE.CylinderGeometry(halfW * 0.6, halfW * 0.6, seatTop - baseY, 24);
      seat.translate(0, (seatTop + baseY) / 2, 0);
      parts.push({ name: "seat", geometry: seat });
      const plateT = Math.max(0.5, minWall);
      parts.push({ name: "seat-plate", geometry: annulusSolid(cut, dia, wall * 0.5, plateT, seatTop), thickness: plateT });
    }
  } else if (setting === "illusion") {
    // a wide plate around the girdle makes the stone read larger
    const plateT = Math.max(0.8, minWall);
    const reach = Math.max(0.8, dia * 0.22);
    parts.push({ name: "illusion-plate", geometry: collar(cut, dia, reach, plateT, girdleY - 0.05), thickness: plateT });
    prism(reach, girdleY - 0.05 - plateT, girdleY + 0.3);
    prongSet(prongs, 0.4);
  }
  return parts;
}

// ---- band fills ----

// Hex lattice over the band; `inside(s, w)` decides membership.
function hexFill(d, geom, dia, gap, inside, role, occupied = [], colliders = []) {
  if (d.shank.profile === "none") return [];
  const { width, circumference } = geom;
  const pitch = dia + gap;
  const rowH = (pitch * Math.sqrt(3)) / 2;
  const head = new THREE.Vector3(0, geom.ro, 0);
  const headR = d.stone.setting === "none" ? 0 : d.stone.dia * 0.3 + dia / 2 + 0.3;
  const out = [];
  const rows = Math.floor((width / 2 - dia / 2 - EDGE) / rowH);
  const count = Math.floor(circumference / pitch);
  const step = circumference / count; // closes the ring evenly
  for (let j = -rows; j <= rows; j++) {
    const w = j * rowH;
    const offset = (j & 1) * (step / 2);
    for (let k = 0; k < count; k++) {
      let s = k * step + offset;
      if (s > circumference / 2) s -= circumference; // -C/2..C/2, 0 at the top
      if (!inside(s, w)) continue;
      const { pos, normal } = surfaceAt(d, geom, s, w, -0.05);
      if (pos.distanceTo(head) < headR) continue; // keep clear of the head
      // keep clear of stones already placed (accents, strokes, earlier fills)
      if (occupied.some((o) => o.role !== "centre" && o.pos.distanceTo(pos) < (o.dia * CUTS[o.cut].aspect + dia) / 2 + gap)) continue;
      if (hitsMetal(pos, dia / 2 + gap, colliders, role)) continue; // clear of other settings' metal
      out.push({ cut: "round", dia, role, pos, normal, s, w });
    }
  }
  return out;
}

const wrapDist = (a, b, C) => Math.abs((((a - b + C / 2) % C) + C) % C - C / 2);

function pointInPoly(s, w, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [si, wi] = pts[i], [sj, wj] = pts[j];
    if (wi > w !== wj > w && s < ((sj - si) * (w - wi)) / (wj - wi) + si) inside = !inside;
  }
  return inside;
}

// Among stocked melee sizes in [lo, hi], the one covering the most area
// (stones * dia^2); ties go to the larger stone.
function autoFill(lo, hi, fill) {
  let best = null;
  for (const dia of MELEE_SIZES.filter((x) => x >= lo - 1e-9 && x <= hi + 1e-9)) {
    const stones = fill(dia);
    const covered = stones.length * dia * dia;
    if (stones.length && (!best || covered > best.covered + 1e-9 || (Math.abs(covered - best.covered) <= 1e-9 && dia > best.dia))) {
      best = { dia, stones, covered };
    }
  }
  return best;
}

// Shared beads: one bead between each pair of neighbouring stones.
function beadsFor(d, geom, stones, beadDia) {
  const geos = [];
  const seen = new Set();
  for (let i = 0; i < stones.length; i++) {
    for (let j = i + 1; j < stones.length; j++) {
      const a = stones[i], b = stones[j];
      const reach = (a.dia + b.dia) / 2 + Math.max(0.4, beadDia * 1.6);
      if (a.pos.distanceTo(b.pos) > reach) continue;
      const s = (a.s + b.s) / 2, w = (a.w + b.w) / 2;
      const key = `${s.toFixed(2)},${w.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const { pos } = surfaceAt(d, geom, s, w, beadDia * 0.3);
      const g = new THREE.SphereGeometry(beadDia / 2, 8, 6);
      g.translate(pos.x, pos.y, pos.z);
      geos.push(g);
    }
  }
  return geos;
}

const mirrorPts = (pts) => pts.map(([s, w]) => [-s, w]);

// Points at equal spacing along an (s, w) polyline.
function alongPath(pts, n) {
  const segs = [];
  let L = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    segs.push({ a: pts[i], b: pts[i + 1], start: L, len });
    L += len;
  }
  const at = (dist) => {
    const sg = segs.find((q) => dist <= q.start + q.len + 1e-9) || segs[segs.length - 1];
    const t = sg.len ? (dist - sg.start) / sg.len : 0;
    return [sg.a[0] + (sg.b[0] - sg.a[0]) * t, sg.a[1] + (sg.b[1] - sg.a[1]) * t, (sg.b[0] - sg.a[0]) / (sg.len || 1), (sg.b[1] - sg.a[1]) / (sg.len || 1)];
  };
  return { L, at, pointsAt: (count, spacing) => Array.from({ length: count }, (_, i) => at((L - (count - 1) * spacing) / 2 + i * spacing)) };
}

function buildStroke(d, geom, o, pts, id, metal, stones, warnings, colliders = []) {
  if (d.shank.profile === "none") return;
  const path = alongPath(pts, 0);
  let dia = o.dia;
  let count;
  if (o.count) {
    count = o.count;
    dia = path.L / count - o.gap;
    if (dia < 0.8 || dia > 3) {
      // the count can't be met with stones in 0.8-3 mm: fit as many as will go
      const fixed = Math.min(3, Math.max(0.8, dia));
      const fits = Math.max(1, Math.floor((path.L + o.gap) / (fixed + o.gap)));
      warnings.push(`stroke ${id}: ${count} stones don't fit on ${path.L.toFixed(1)} mm (they would be ${dia.toFixed(2)} mm); placed ${fits} of ${fixed} mm`);
      count = fits;
      dia = fixed;
    }
  } else {
    count = Math.max(1, Math.floor((path.L + o.gap) / (dia + o.gap)));
  }
  const spacing = count > 1 ? Math.min(dia + o.gap, path.L / (count - 1)) : 0;
  const pitch = o.count && path.L / count >= dia + o.gap - 1e-9 ? path.L / count : Math.max(spacing, dia + o.gap);
  const head = new THREE.Vector3(0, geom.ro, 0);
  const headR = d.stone.setting === "none" ? 0 : d.stone.dia * 0.3 + dia / 2 + 0.3;
  let skipped = 0;
  const row = path.pointsAt(count, pitch).map(([s, w]) => {
    const { pos, normal } = surfaceAt(d, geom, s, w, -0.05);
    return { cut: "round", dia, role: "stroke", obj: id, pos, normal, s, w };
  }).filter((st) => {
    // keep clear of the head and of stones already placed, as fills do
    const blocked = st.pos.distanceTo(head) < headR || hitsMetal(st.pos, dia / 2 + o.gap, colliders, id) || stones.some((o2) => o2.role !== "centre" && o2.pos.distanceTo(st.pos) < (o2.dia * CUTS[o2.cut].aspect + dia) / 2 + o.gap);
    if (blocked) skipped++;
    return !blocked;
  });
  if (skipped) warnings.push(`stroke ${id}: ${skipped} stone(s) left out where the path runs into the head or other stones`);
  stones.push(...row);
  if (o.setting === "bead") {
    const g = merged(beadsFor(d, geom, row, o.bead));
    if (g) metal.push({ name: `beads ${id}`, obj: id, geometry: g, bead: true });
  } else if (o.setting === "channel") {
    const rail = 0.4;
    const rails = [];
    for (const side of [-1, 1]) {
      const samples = Math.max(2, Math.ceil(path.L / 0.6));
      let prev = null;
      for (let i = 0; i <= samples; i++) {
        const [s, w, ds, dw] = path.at((i / samples) * path.L);
        const off = side * (dia / 2 + rail * 0.9);
        const { pos } = surfaceAt(d, geom, s - dw * off, w + ds * off, rail * 0.6);
        if (prev) rails.push(rod(prev, pos, rail, 8));
        prev = pos;
      }
    }
    const g = merged(rails);
    if (g) metal.push({ name: `channel ${id}`, obj: id, geometry: g, thickness: rail * 2 });
  }
}

// sculpts: Map id -> { geometry, info } of prepared (repaired) sculpt meshes,
// or { pending: true } / { error } while loading. See sculpts.js.
// ---- pavé on sculpt surfaces ----

// Pack round stones of `dia` over the part of the surface within r of any dab.
function surfaceFill(grid, dabs, r, dia, gap, id, occupied, colliders = []) {
  const pitch = dia + gap;
  const tri = new THREE.Triangle();
  const centres = dabs.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const tris = new Set();
  for (const c of centres) for (const t of grid.near(c, r + grid.cell)) tris.add(t);
  // candidate points on the brushed surface, deduplicated on a fine grid
  const seen = new Set();
  const cand = [];
  const step = pitch / 3;
  for (const t of tris) {
    grid.tri(t, tri.a, tri.b, tri.c);
    const len = Math.max(tri.a.distanceTo(tri.b), tri.b.distanceTo(tri.c), tri.c.distanceTo(tri.a));
    const u = Math.max(1, Math.ceil(len / step));
    for (let i = 0; i <= u; i++) for (let j = 0; j <= u - i; j++) {
      const q = tri.a.clone().addScaledVector(tri.b.clone().sub(tri.a), i / u).addScaledVector(tri.c.clone().sub(tri.a), j / u);
      if (!centres.some((c) => c.distanceTo(q) <= r)) continue;
      const key = `${Math.round(q.x / (step / 2))},${Math.round(q.y / (step / 2))},${Math.round(q.z / (step / 2))}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cand.push({ q, t });
    }
  }
  // grow from the start of the stroke, so the layout follows the brush
  cand.sort((a, b) => a.q.distanceTo(centres[0]) - b.q.distanceTo(centres[0]));
  const placed = [];
  const hash = new Map();
  const hkey = (p) => [Math.floor(p.x / pitch), Math.floor(p.y / pitch), Math.floor(p.z / pitch)];
  const tooClose = (p) => {
    const [i, j, k] = hkey(p);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      for (const o of hash.get(`${i + a},${j + b},${k + c}`) || []) if (o.distanceTo(p) < pitch - 1e-6) return true;
    }
    return false;
  };
  for (const { q, t } of cand) {
    if (tooClose(q)) continue;
    const n = grid.smoothNormal(q, dia * 0.6) || grid.normal(t);
    // a sharp edge or crease under the stone (the local face disagrees with
    // the averaged normal) is no place for a stone
    if (grid.normal(t).dot(n) < 0.85) continue;
    // the whole girdle must sit on the surface: no overhanging an edge
    const u = new THREE.Vector3(1, 0, 0).cross(n);
    if (u.lengthSq() < 1e-6) u.set(0, 1, 0).cross(n);
    u.normalize();
    const v = n.clone().cross(u);
    let onSurface = true;
    for (let k = 0; k < 8 && onSurface; k++) {
      const a = (k / 8) * Math.PI * 2;
      const sp = q.clone().addScaledVector(u, Math.cos(a) * dia * 0.5).addScaledVector(v, Math.sin(a) * dia * 0.5);
      // over the same face (not a side face past an edge), and close to it
      // and directly under the girdle point (not off to the side at an edge)
      const cp = grid.closestPoint(sp, 0.6);
      if (!cp || cp.dist > 0.2 || grid.normal(cp.tri).dot(n) < 0.85) onSurface = false;
      else {
        const off = sp.clone().sub(cp.point);
        if (off.clone().addScaledVector(n, -off.dot(n)).length() > 0.05) onSurface = false;
      }
    }
    if (!onSurface) continue;
    const pos = q.clone().addScaledVector(n, -0.05);
    if (occupied.some((o) => o.pos.distanceTo(pos) < (o.dia * CUTS[o.cut].aspect + dia) / 2 + gap)) continue;
    if (hitsMetal(pos, dia / 2 + gap, colliders, id)) continue;
    // metal left under the culet: through the sculpt to its far side
    const through = grid.raycast(q.clone().addScaledVector(n, -0.01), n.clone().negate(), 10, 0.02, true);
    placed.push({ cut: "round", dia, role: "surface", obj: id, pos, normal: n, metalBelow: through === null ? null : through - 0.43 * dia - 0.05 });
    const [i, j, k] = hkey(q);
    const key = `${i},${j},${k}`;
    (hash.get(key) || hash.set(key, []).get(key)).push(q);
  }
  return placed;
}

// Beads between neighbouring surface stones, sitting on the surface.
function surfaceBeads(grid, stones, beadDia) {
  const geos = [];
  for (let i = 0; i < stones.length; i++) for (let j = i + 1; j < stones.length; j++) {
    const a = stones[i], b = stones[j];
    if (a.pos.distanceTo(b.pos) > (a.dia + b.dia) / 2 + Math.max(0.4, beadDia * 1.6)) continue;
    const mid = a.pos.clone().add(b.pos).multiplyScalar(0.5);
    const cp = grid.closestPoint(mid, 1);
    if (!cp) continue;
    const n = a.normal.clone().add(b.normal).normalize();
    const at = cp.point.addScaledVector(n, beadDia * 0.3);
    const g = new THREE.SphereGeometry(beadDia / 2, 8, 6);
    g.translate(at.x, at.y, at.z);
    geos.push(g);
  }
  return geos;
}

export function build(d, { quality = "standard", sculpts = new Map() } = {}) {
  const size = parseSize(d.ring.size);
  const diameter = d.ring.diameter ?? size.innerDiameter;
  const ri = diameter / 2;
  const seg = QUALITY[quality] ?? QUALITY.standard;
  const ro = ri + d.shank.thickness;
  const w = d.shank.width;
  const geom = { ri, ro, width: w, circumference: TAU * ro, innerDiameter: diameter };
  const metal = [];
  const stones = [];
  const warnings = [];
  const colliders = [];
  const minWall = d.rule.min_wall;

  // shank: revolve the profile around Z, then stand the ring up
  // (profile=none: no band, for example when a sculpt is the whole ring)
  const hasBand = d.shank.profile !== "none";
  if (hasBand) {
    const lathe = new THREE.LatheGeometry(subdivide(shankProfile(ri, ro, w, d.shank.profile)).map(([r, y]) => new THREE.Vector2(r, y)), seg);
    lathe.rotateX(Math.PI / 2);
    metal.push({ name: "shank", obj: "shank", geometry: fixWinding(lathe) });
  }

  // sculpts: prepared meshes (already watertight solids) placed as metal
  const sculptInfo = {};
  for (const sc of d.sculpts) {
    const got = sculpts.get(sculptKey(sc));
    if (!got || got.pending) warnings.push(`sculpt ${sc.id}: preparing…`);
    else if (got.error) warnings.push(`sculpt ${sc.id}: ${got.error}`);
    else {
      metal.push({ name: `sculpt ${sc.id}`, obj: sc.id, geometry: got.geometry, sculpt: true });
      sculptInfo[sc.id] = got.info;
    }
  }
  if (!hasBand && (d.paint.length || d.strokes.length || d.regions.length)) warnings.push("pavé on the band needs a band: shank profile is none");
  const gridOf = (scId) => {
    const sc = d.sculpts.find((x) => x.id === scId);
    const got = sc && sculpts.get(sculptKey(sc));
    if (!got?.geometry) return null;
    return (got.grid ||= new TriGrid(got.geometry));
  };

  // centre stone and head (setting=none: a plain band, e.g. an eternity ring)
  const hasCentre = d.stone.setting !== "none";
  const dia = d.stone.dia;
  const cut = CUTS[d.stone.cut];
  const girdleY = ro + 0.5 + 0.43 * dia;
  if (hasCentre) {
    stones.push({ cut: d.stone.cut, dia, role: "centre", obj: "stone", pos: new THREE.Vector3(0, girdleY, 0), normal: UP.clone() });
    const head = headParts({ ...d.stone, baseY: ro - 0.3, girdleY, minWall });
    for (const p of head) metal.push({ ...p, obj: "stone", geometry: fixWinding(p.geometry) });
    for (const c of head.colliders) colliders.push({ ...c, frame: new THREE.Matrix4(), obj: "stone" });
  } else if (d.halo) warnings.push("halo needs a centre stone; it is ignored while stone setting=none");

  // halo follows the cut's girdle outline
  if (d.halo && hasCentre) {
    const { dia: hd, gap } = d.halo;
    const kind = d.halo.kind || "single";
    const halfW = dia / 2, halfL = (dia * cut.aspect) / 2;
    // halo stones start outside whatever holds the centre stone
    const base = d.stone.setting === "bezel" ? Math.max(0.5, minWall) : d.stone.setting === "illusion" ? Math.max(0.8, dia * 0.22) : prongReach(dia);
    const rings = [];
    if (kind === "hidden") {
      // under the girdle, tucked around the pavilion
      rings.push({ off: gap + hd / 2 - dia * 0.12, y: girdleY - 0.43 * dia * 0.45, hd, role: "halo" });
    } else {
      rings.push({ off: base + gap + hd / 2, y: girdleY - 0.15, hd, role: "halo" });
      if (kind === "double") {
        const hd2 = Math.max(0.8, Math.round(hd * 0.85 * 10) / 10);
        rings.push({ off: base + gap + hd + gap + hd2 / 2, y: girdleY - 0.3, hd: hd2, role: "halo2" });
      }
    }
    // Equal arc spacing crowds stones at sharp points (pear and marquise tips),
    // and a scaled outline is not a true offset, so rings pinch together there:
    // keep a stone only if it clears every halo stone already kept, in any ring.
    // Prongs come first: a halo stone is skipped where a prong passes, as a
    // bench jeweller would leave the prong between two halo stones.
    const segDist = (p, a, b) => {
      const ab = b.clone().sub(a);
      const t = ab.lengthSq() ? Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())) : 0;
      return a.clone().addScaledVector(ab, t).distanceTo(p);
    };
    const kept = [];
    let planned = 0;
    for (const r of rings) {
      for (const [x, z] of spaceAlong(outline(d.stone.cut, dia, r.off), r.hd + gap).pts) {
        planned++;
        const pos = new THREE.Vector3(x, r.y, z);
        if (colliders.some((c) => segDist(pos, c.a, c.b) < c.r + r.hd / 2 + 0.05)) continue;
        if (kept.every((k) => k.pos.distanceTo(pos) >= (k.dia + r.hd) / 2 + gap * 0.5)) kept.push({ pos, dia: r.hd });
        else continue;
        stones.push({ cut: "round", dia: r.hd, role: r.role, obj: "halo", pos, normal: UP.clone() });
      }
    }
    // prongs always pass through a hidden halo's ring, so it may lose more
    if (kept.length < planned * (kind === "hidden" ? 0.6 : 0.75)) {
      warnings.push(`halo: ${planned - kept.length} of ${planned} stone positions are blocked by prongs; use fewer prongs or a ${d.halo.kind === "hidden" ? "single" : "smaller"} halo`);
    }
    // a frame under the halo stones only: an outline-following ring, open in
    // the middle so the centre stone's pavilion stays clear
    const inner = rings[0], outer = rings[rings.length - 1];
    const plateT = Math.max(0.8, minWall);
    const top = Math.min(...rings.map((r) => r.y - r.hd * 0.43)) + 0.05;
    const frame = annulus(d.stone.cut, dia, inner.off - inner.hd / 2 - 0.05, outer.off + outer.hd * 0.4, plateT, top);
    metal.push({ name: "halo-frame", obj: "halo", geometry: fixWinding(frame), thickness: plateT });
    // two posts tie the frame to the band, either side along the finger
    const px = halfW + (inner.off + outer.off) / 2;
    for (const sx of [-1, 1]) {
      const footY = Math.sqrt(Math.max(0, ro * ro - px * px)) - 0.3;
      const [pa, pb] = [new THREE.Vector3(sx * px, top - plateT / 2, 0), new THREE.Vector3(sx * px, footY, 0)];
      const post = rod(pa, pb, 0.45);
      colliders.push({ a: pa, b: pb, r: 0.45, obj: "halo" });
      metal.push({ name: `halo-post${sx > 0 ? 2 : 1}`, obj: "halo", geometry: fixWinding(post), thickness: 0.9 });
    }
  }

  // accents: single stones on the band, optionally mirrored to the other shoulder
  for (const a of d.accents) {
    for (const [s, id] of a.mirror === "yes" ? [[a.s, a.id], [-a.s, `${a.id}~mirror`]] : [[a.s, a.id]]) {
      const { pos, normal } = surfaceAt(d, geom, s, a.w);
      const turn = (a.turn || 0) * (id.endsWith("~mirror") ? -1 : 1);
      const q = new THREE.Quaternion().setFromUnitVectors(UP, normal).multiply(new THREE.Quaternion().setFromAxisAngle(UP, (turn * Math.PI) / 180));
      const frame = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
      const flush = a.setting === "flush";
      const localGirdle = flush ? -0.05 : 0.43 * a.dia * 0.5 + 0.15;
      stones.push({
        cut: a.cut, dia: a.dia, role: "accent", obj: a.id, s, w: a.w, flush, turn,
        // how far the culet reaches below the band surface (into the metal)
        culetDepth: 0.43 * a.dia - localGirdle,
        pos: new THREE.Vector3(0, localGirdle, 0).applyMatrix4(frame), normal,
      });
      if (!flush) {
        const head = headParts({ cut: a.cut, dia: a.dia, setting: a.setting, prongs: a.prongs ?? 4, tip: a.tip, baseY: -0.3, girdleY: localGirdle, minWall });
        for (const p of head) metal.push({ ...p, name: `${id} ${p.name}`, obj: a.id, geometry: fixWinding(p.geometry.applyMatrix4(frame)) });
        for (const c of head.colliders) {
          colliders.push(c.type === "prism" ? { ...c, frame, obj: a.id } : { a: c.a.clone().applyMatrix4(frame), b: c.b.clone().applyMatrix4(frame), r: c.r, obj: a.id });
        }
      }
    }
  }

  // strokes: one row of stones along a drawn path
  for (const st of d.strokes) {
    buildStroke(d, geom, st, st.pts, st.id, metal, stones, warnings, colliders);
    if (st.mirror === "yes") buildStroke(d, geom, st, mirrorPts(st.pts), `${st.id}~mirror`, metal, stones, warnings, colliders);
  }

  // regions: closed outlines filled with a hex lattice
  const fillRegion = (rg, pts, id) => {
    const C = geom.circumference;
    const inside = (s, ww) => pointInPoly(s, ww, pts) || pointInPoly(s + C, ww, pts) || pointInPoly(s - C, ww, pts);
    const fill = (dd) => hexFill(d, geom, dd, rg.gap, inside, "region", stones, colliders).map((x) => ({ ...x, obj: id }));
    let row;
    if (rg.dia === "auto") {
      const best = autoFill(rg.min ?? 0.9, rg.max ?? 2, fill);
      if (!best) warnings.push(`region ${id}: no stocked melee size fits`);
      row = best ? best.stones : [];
    } else row = fill(rg.dia);
    if (!row.length && rg.dia !== "auto") warnings.push(`region ${id}: no ${rg.dia} mm stones fit inside it on this band`);
    stones.push(...row);
    if (rg.setting === "bead") {
      const g = merged(beadsFor(d, geom, row, rg.bead));
      if (g) metal.push({ name: `beads ${id}`, obj: id, geometry: g, bead: true });
    }
  };
  for (const rg of d.regions) {
    fillRegion(rg, rg.pts, rg.id);
    if (rg.mirror === "yes") fillRegion(rg, mirrorPts(rg.pts), `${rg.id}~mirror`);
  }

  // pavé brushed onto sculpt surfaces
  for (const sp of d.surfpaves) {
    const grid = gridOf(sp.on);
    if (!grid) continue; // the sculpt is still preparing (reported above)
    for (const [dabs, id] of sp.mirror === "yes" ? [[sp.pts, sp.id], [sp.pts.map(([x, y, z]) => [-x, y, z]), `${sp.id}~mirror`]] : [[sp.pts, sp.id]]) {
      const fill = (dd) => surfaceFill(grid, dabs, sp.r, dd, sp.gap, id, stones, colliders);
      let row;
      if (sp.dia === "auto") {
        const best = autoFill(sp.min ?? 0.9, sp.max ?? 2, fill);
        row = best ? best.stones : [];
        if (!best) warnings.push(`surfpave ${id}: no stocked melee size fits where you painted`);
      } else {
        row = fill(sp.dia);
        if (!row.length) warnings.push(`surfpave ${id}: no ${sp.dia} mm stones fit where you painted`);
      }
      stones.push(...row);
      if (sp.setting === "bead" && row.length) {
        const g = merged(surfaceBeads(grid, row, sp.bead));
        if (g) metal.push({ name: `beads ${id}`, obj: id, geometry: g, bead: true });
      }
    }
  }

  // brushed pavé (paint lines)
  let paveDia = d.pave.dia;
  if (d.paint.length) {
    const C = geom.circumference;
    const inside = (s, ww) => d.paint.some((p) => Math.hypot(wrapDist(s, p.s, C), ww - p.w) <= p.r);
    const fill = (dd) => hexFill(d, geom, dd, d.pave.gap, inside, "pave", stones, colliders).map((x) => ({ ...x, obj: "pave" }));
    let row;
    if (d.pave.dia === "auto") {
      const best = autoFill(d.pave.min ?? 0.9, d.pave.max ?? 2, fill);
      paveDia = best ? best.dia : null;
      row = best ? best.stones : [];
    } else row = fill(d.pave.dia);
    if (!row.length) warnings.push(d.pave.dia === "auto" ? "brushed pavé: no stocked melee size fits where you painted" : `brushed pavé: no ${d.pave.dia} mm stones fit where you painted`);
    stones.push(...row);
    if (d.pave.bead > 0) {
      const g = merged(beadsFor(d, geom, row, d.pave.bead));
      if (g) metal.push({ name: "beads pave", obj: "pave", geometry: g, bead: true });
    }
  } else if (d.pave.dia === "auto") paveDia = null;

  return { metal, stones, geom, design: d, paveDia, warnings, colliders, sculptInfo, hasBand };
}
