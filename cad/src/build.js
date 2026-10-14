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

export { fixWinding, signedVolume };

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const QUALITY = { draft: 64, standard: 160, fine: 320 };

// World transform of a stone: girdle centre at pos, table facing along normal.
export const stoneMatrix = (s) =>
  new THREE.Matrix4().compose(s.pos, new THREE.Quaternion().setFromUnitVectors(UP, s.normal), new THREE.Vector3(1, 1, 1));

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

function collar(cut, dia, wall, height, topY) {
  const shape = new THREE.Shape(outline(cut, dia, wall).map(([x, z]) => new THREE.Vector2(x, z)));
  shape.holes.push(new THREE.Path(outline(cut, dia, -0.02).map(([x, z]) => new THREE.Vector2(x, z)).reverse()));
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2); // extrude axis -> +y, outline in xz
  g.translate(0, topY - height, 0);
  return g;
}

// Returns metal parts in the local frame for a stone of `cut`/`dia` whose
// girdle sits at girdleY, with metal starting at baseY.
function headParts({ cut, dia, setting, prongs = 4, tip = "round", baseY, girdleY, minWall }) {
  const parts = [];
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
      parts.push({ name: `tip${i + 1}`, geometry: tipGeometry(tip, pr, new THREE.Vector3(x * 0.97, girdleY + 0.25, z * 0.97), inward) });
    }
  };
  if (setting === "prong") {
    const pr = Math.max(0.4, Math.min(0.6, dia * 0.07)); // 0.8-1.2 mm wire
    prongSet(prongs, pr);
    const wire = Math.max(0.45, pr * 0.8);
    const m = Math.max(halfW, halfL);
    const gallery = new THREE.TorusGeometry(m * 0.5, wire, 8, 40);
    gallery.rotateX(Math.PI / 2);
    gallery.scale(halfW / m, 1, halfL / m);
    gallery.translate(0, baseY + 0.3 + pav * 0.35, 0);
    parts.push({ name: "gallery", geometry: gallery, thickness: wire * 2 });
  } else if (setting === "bezel") {
    const wall = Math.max(0.5, minWall);
    const h = Math.max(0.6, girdleY - baseY + 0.3 - pav * 0.4);
    parts.push({ name: "bezel", geometry: collar(cut, dia, wall, h, girdleY + 0.3), thickness: wall });
    const seat = new THREE.CylinderGeometry(halfW * 0.7, halfW * 0.5, Math.max(0.4, girdleY - h + 0.3 - baseY + 0.2), 20);
    seat.translate(0, (baseY + girdleY - h + 0.3) / 2, 0);
    parts.push({ name: "seat", geometry: seat });
  } else if (setting === "illusion") {
    // a wide plate around the girdle makes the stone read larger
    const plateT = Math.max(0.8, minWall);
    parts.push({ name: "illusion-plate", geometry: collar(cut, dia, Math.max(0.8, dia * 0.22), plateT, girdleY - 0.05), thickness: plateT });
    prongSet(4, 0.4);
  }
  return parts;
}

// ---- band fills ----

// Hex lattice over the band; `inside(s, w)` decides membership.
function hexFill(d, geom, dia, gap, inside, role, occupied = []) {
  const { width, circumference } = geom;
  const pitch = dia + gap;
  const rowH = (pitch * Math.sqrt(3)) / 2;
  const head = new THREE.Vector3(0, geom.ro, 0);
  const headR = d.stone.dia * 0.3 + dia / 2 + 0.3;
  const out = [];
  const rows = Math.floor((width / 2 - dia / 2 - 0.1) / rowH);
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

function buildStroke(d, geom, o, pts, id, metal, stones, warnings) {
  const path = alongPath(pts, 0);
  let dia = o.dia;
  let count;
  if (o.count) {
    count = o.count;
    dia = path.L / count - o.gap;
    if (dia < 0.8 || dia > 3) {
      warnings.push(`stroke ${id}: ${count} stones on ${path.L.toFixed(1)} mm gives ${dia.toFixed(2)} mm stones (allowed 0.8-3)`);
      dia = Math.min(3, Math.max(0.8, dia));
    }
  } else {
    count = Math.max(1, Math.floor((path.L + o.gap) / (dia + o.gap)));
  }
  const spacing = count > 1 ? Math.min(dia + o.gap, path.L / (count - 1)) : 0;
  const row = path.pointsAt(count, o.count ? path.L / count : spacing).map(([s, w]) => {
    const { pos, normal } = surfaceAt(d, geom, s, w, -0.05);
    return { cut: "round", dia, role: "stroke", obj: id, pos, normal, s, w };
  });
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

export function build(d, { quality = "standard" } = {}) {
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
  const minWall = d.rule.min_wall;

  // shank: revolve the profile around Z, then stand the ring up
  const lathe = new THREE.LatheGeometry(shankProfile(ri, ro, w, d.shank.profile).map(([r, y]) => new THREE.Vector2(r, y)), seg);
  lathe.rotateX(Math.PI / 2);
  metal.push({ name: "shank", obj: "shank", geometry: fixWinding(lathe) });

  // centre stone and head
  const dia = d.stone.dia;
  const cut = CUTS[d.stone.cut];
  const girdleY = ro + 0.5 + 0.43 * dia;
  stones.push({ cut: d.stone.cut, dia, role: "centre", obj: "stone", pos: new THREE.Vector3(0, girdleY, 0), normal: UP.clone() });
  for (const p of headParts({ ...d.stone, baseY: ro - 0.3, girdleY, minWall })) {
    metal.push({ ...p, obj: "stone", geometry: fixWinding(p.geometry) });
  }

  // halo follows the cut's girdle outline
  if (d.halo) {
    const { dia: hd, gap } = d.halo;
    const kind = d.halo.kind || "single";
    const halfW = dia / 2, halfL = (dia * cut.aspect) / 2;
    const base = d.stone.setting === "bezel" ? Math.max(0.5, minWall) : d.stone.setting === "illusion" ? Math.max(0.8, dia * 0.22) : 0;
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
    for (const r of rings) {
      for (const [x, z] of spaceAlong(outline(d.stone.cut, dia, r.off), r.hd + gap).pts) {
        stones.push({ cut: "round", dia: r.hd, role: r.role, obj: "halo", pos: new THREE.Vector3(x, r.y, z), normal: UP.clone() });
      }
    }
    const outer = rings[rings.length - 1];
    const plateT = Math.max(0.8, minWall);
    const plate = new THREE.CylinderGeometry(Math.max(halfW, halfL) + outer.off + outer.hd * 0.4, halfW * 0.6, plateT, 40);
    plate.translate(0, outer.y - outer.hd * 0.43 - plateT / 2 + 0.05, 0);
    metal.push({ name: "halo-plate", obj: "halo", geometry: fixWinding(plate), thickness: plateT });
  }

  // accents: single stones on the band, optionally mirrored to the other shoulder
  for (const a of d.accents) {
    for (const [s, id] of a.mirror === "yes" ? [[a.s, a.id], [-a.s, `${a.id}~mirror`]] : [[a.s, a.id]]) {
      const { pos, normal } = surfaceAt(d, geom, s, a.w);
      const frame = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromUnitVectors(UP, normal), new THREE.Vector3(1, 1, 1));
      const flush = a.setting === "flush";
      const localGirdle = flush ? -0.05 : 0.43 * a.dia * 0.5 + 0.15;
      stones.push({
        cut: a.cut, dia: a.dia, role: "accent", obj: a.id, s, w: a.w,
        pos: new THREE.Vector3(0, localGirdle, 0).applyMatrix4(frame), normal,
      });
      if (!flush) {
        for (const p of headParts({ cut: a.cut, dia: a.dia, setting: a.setting, prongs: a.prongs ?? 4, tip: a.tip, baseY: -0.3, girdleY: localGirdle, minWall })) {
          metal.push({ ...p, name: `${id} ${p.name}`, obj: a.id, geometry: fixWinding(p.geometry.applyMatrix4(frame)) });
        }
      }
    }
  }

  // strokes: one row of stones along a drawn path
  for (const st of d.strokes) {
    buildStroke(d, geom, st, st.pts, st.id, metal, stones, warnings);
    if (st.mirror === "yes") buildStroke(d, geom, st, mirrorPts(st.pts), `${st.id}~mirror`, metal, stones, warnings);
  }

  // regions: closed outlines filled with a hex lattice
  const fillRegion = (rg, pts, id) => {
    const C = geom.circumference;
    const inside = (s, ww) => pointInPoly(s, ww, pts) || pointInPoly(s + C, ww, pts) || pointInPoly(s - C, ww, pts);
    const fill = (dd) => hexFill(d, geom, dd, rg.gap, inside, "region", stones).map((x) => ({ ...x, obj: id }));
    let row;
    if (rg.dia === "auto") {
      const best = autoFill(rg.min ?? 0.9, rg.max ?? 2, fill);
      if (!best) warnings.push(`region ${id}: no stocked melee size fits`);
      row = best ? best.stones : [];
    } else row = fill(rg.dia);
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

  // brushed pavé (paint lines)
  let paveDia = d.pave.dia;
  if (d.paint.length) {
    const C = geom.circumference;
    const inside = (s, ww) => d.paint.some((p) => Math.hypot(wrapDist(s, p.s, C), ww - p.w) <= p.r);
    const fill = (dd) => hexFill(d, geom, dd, d.pave.gap, inside, "pave", stones).map((x) => ({ ...x, obj: "pave" }));
    let row;
    if (d.pave.dia === "auto") {
      const best = autoFill(d.pave.min ?? 0.9, d.pave.max ?? 2, fill);
      paveDia = best ? best.dia : null;
      row = best ? best.stones : [];
    } else row = fill(d.pave.dia);
    stones.push(...row);
    if (d.pave.bead > 0) {
      const g = merged(beadsFor(d, geom, row, d.pave.bead));
      if (g) metal.push({ name: "beads pave", obj: "pave", geometry: g, bead: true });
    }
  } else if (d.pave.dia === "auto") paveDia = null;

  return { metal, stones, geom, design: d, paveDia, warnings };
}
