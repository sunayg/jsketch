// Measurements and checks from a built model.
import * as THREE from "three";
import { METALS } from "./script.js";
import { CUTS, caratOf, isStockedMelee, outline } from "./gems.js";
import { signedVolume, openEdges } from "./geom.js";
import { shankThicknessAt, EDGE } from "./build.js";

const FLUSH = new Set(["pave", "region", "stroke"]);

const polyArea = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a) / 2;
};

// Thinnest point of the shank profile and where it is.
function shankMinWall(d, geom) {
  let best = { mm: Infinity, w: 0 };
  for (let i = 0; i <= 200; i++) {
    const w = -geom.width / 2 + (geom.width * i) / 200;
    const t = shankThicknessAt(d, geom, w);
    if (t < best.mm - 1e-9) best = { mm: t, w };
  }
  return best;
}

export function report(model) {
  const d = model.design;
  const metal = METALS[d.ring.metal];
  const density = d.ring.density ?? metal.density;
  const { ri, ro, width } = model.geom;

  // flush-set stones sit in drilled seats: take their pavilion out of the metal
  const flush = model.stones.filter((s) => FLUSH.has(s.role) || (s.role === "accent" && s.flush));
  const seatVolumeMm3 = flush.reduce((v, s) => v + (polyArea(outline(s.cut, s.dia, 0, 48)) * 0.43 * s.dia) / 3, 0);

  const partVolumes = new Map();
  for (const m of model.metal) {
    const v = Math.abs(signedVolume(m.geometry));
    partVolumes.set(m.obj || m.name, (partVolumes.get(m.obj || m.name) || 0) + v);
  }
  const grossMm3 = [...partVolumes.values()].reduce((a, b) => a + b, 0);
  const volumeMm3 = Math.max(0, grossMm3 - seatVolumeMm3);
  const weightG = (volumeMm3 / 1000) * density;
  const parts = [...partVolumes.entries()].map(([obj, v]) => ({ obj, volumeMm3: v, weightG: (v / 1000) * density }));

  const groups = new Map();
  for (const s of model.stones) {
    const key = `${s.role}|${s.cut}|${s.dia}`;
    groups.set(key, { role: s.role, cut: s.cut, dia: s.dia, count: (groups.get(key)?.count || 0) + 1, each: caratOf(s.cut, s.dia) });
  }
  const stoneList = [...groups.values()].map((g) => ({ ...g, total: g.count * g.each }));
  const totalCt = stoneList.reduce((s, g) => s + g.total, 0);

  const checks = [];
  const at = (p) => `(${p.map((v) => v.toFixed(2)).join(", ")})`;
  const minWall = d.rule.min_wall;

  // walls: the shank's thinnest point, then every part with a known thickness
  const sm = shankMinWall(d, model.geom);
  const thin = [
    { name: "shank", v: sm.mm, p: [0, -(ri + ro) / 2, sm.w] },
    ...model.metal.filter((m) => m.thickness).map((m) => {
      m.geometry.computeBoundingBox();
      return { name: m.name, v: m.thickness, p: m.geometry.boundingBox.getCenter(new THREE.Vector3()).toArray() };
    }),
  ];
  const walls = thin.filter((p) => p.v < minWall - 1e-9);
  for (const p of walls) {
    checks.push({ level: "error", text: `${p.name}: wall is ${p.v.toFixed(2)} mm at ${at(p.p)}, under the ${minWall} mm minimum; thicken it` });
  }

  // open metal: every part should be watertight
  for (const m of model.metal) {
    const open = openEdges(m.geometry);
    if (open) checks.push({ level: "error", text: `${m.name}: ${open} open edge(s); the metal is not watertight` });
  }

  // how far a stone reaches toward the finger axis: pavilion depth along its
  // normal's radial part, girdle radius across it
  const inward = (s) => {
    const r = Math.hypot(s.pos.x, s.pos.y) || 1;
    const c = Math.abs((s.normal.x * s.pos.x + s.normal.y * s.pos.y) / r);
    return 0.43 * s.dia * c + (s.dia / 2) * Math.sqrt(Math.max(0, 1 - c * c));
  };
  // floating metal: every part must touch the shank through a chain of parts
  // (bounding boxes, slightly grown, must overlap; a coarse but useful test)
  const boxes = model.metal.map((m) => {
    m.geometry.computeBoundingBox();
    return m.geometry.boundingBox.clone().expandByScalar(0.05);
  });
  const reached = new Set([0]);
  for (let grew = true; grew; ) {
    grew = false;
    for (let i = 0; i < boxes.length; i++) {
      if (reached.has(i)) continue;
      if ([...reached].some((j) => boxes[j].intersectsBox(boxes[i]))) reached.add(i), (grew = true);
    }
  }
  const floating = model.metal.filter((_, i) => !reached.has(i));
  for (const m of floating) checks.push({ level: "error", text: `${m.name} is not connected to the rest of the metal` });

  // stones that run into prongs of another stone
  const seg = (p, a, b) => {
    const ab = b.clone().sub(a);
    const t = ab.lengthSq() ? Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())) : 0;
    return a.clone().addScaledVector(ab, t).distanceTo(p);
  };
  let prongHits = 0;
  for (const st of model.stones) {
    const holder = st.role === "centre" ? "stone" : st.obj;
    if (model.colliders?.some((c) => c.obj !== holder && c.obj.split("~")[0] !== holder && seg(st.pos, c.a, c.b) < c.r + (st.dia / 2) * 0.95)) prongHits++;
  }
  if (prongHits) checks.push({ level: "error", text: `${prongHits} stone(s) run into another stone's prongs` });

  // band-set stones: metal under the culet, metal at the edge, and spacing
  const set = model.stones.filter((s) => s.w !== undefined && (FLUSH.has(s.role) || s.flush));
  const under = set.map((s) => shankThicknessAt(d, model.geom, s.w) - 0.43 * s.dia - 0.05);
  const thinUnder = under.filter((v) => v < 0.3);
  if (thinUnder.length) checks.push({ level: "warn", text: `${thinUnder.length} band-set stone(s) leave only ${Math.max(0, Math.min(...thinUnder)).toFixed(2)} mm of metal under the culet (aim for 0.3 mm or more)` });
  const edgeLeft = set.map((s) => width / 2 - Math.abs(s.w) - s.dia / 2).filter((v) => v >= -0.01 && v < EDGE - 0.01);
  if (edgeLeft.length) checks.push({ level: "warn", text: `${edgeLeft.length} band-set stone(s) leave under ${EDGE} mm of metal at the band edge (min ${Math.max(0, Math.min(...edgeLeft)).toFixed(2)} mm)` });
  const gaps = [d.pave.gap, ...d.strokes.map((x) => x.gap), ...d.regions.map((x) => x.gap)];
  if (set.length && gaps.some((g) => g < 0.05)) checks.push({ level: "warn", text: "A pavé gap under 0.05 mm leaves stones touching, with no room for beads or seats" });

  const bore = model.stones.filter((s) => Math.hypot(s.pos.x, s.pos.y) - inward(s) < ri - 1e-6);
  if (bore.length) checks.push({ level: "error", text: `${bore.length} stone(s) intrude into the finger bore` });

  // only stones set into the band can overhang it; raised heads may be wider than the shank
  const inBand = model.stones.filter((s) => FLUSH.has(s.role) || (s.role === "accent" && s.flush));
  const over = inBand.filter((s) => Math.abs(s.w) + s.dia / 2 > width / 2 + 0.01);
  if (over.length) checks.push({ level: "error", text: `${over.length} stone(s) overhang the edge of the band` });

  // stones nothing holds: flush stones need beads, a channel or a bead setting
  const held = new Set(model.metal.filter((m) => m.bead || m.name.startsWith("channel")).map((m) => m.obj));
  const loose = model.stones.filter((s) => FLUSH.has(s.role) && !held.has(s.obj));
  if (loose.length) checks.push({ level: "warn", text: `${loose.length} stone(s) have no beads, prongs or channel holding them` });

  for (const g of stoneList) {
    if (!["centre", "accent"].includes(g.role) && !isStockedMelee(g.dia)) {
      checks.push({ level: "warn", text: `${+g.dia.toFixed(2)} mm ${g.role} stones are not a stocked melee size` });
    }
  }
  const sp = model.stones.filter((s) => s.role !== "centre");
  let overlaps = 0;
  for (let i = 0; i < sp.length; i++) {
    for (let j = i + 1; j < sp.length; j++) {
      if (sp[i].pos.distanceTo(sp[j].pos) < (sp[i].dia + sp[j].dia) / 2 - 0.01) overlaps++;
    }
  }
  if (overlaps) checks.push({ level: "error", text: `${overlaps} stone pair(s) overlap` });
  if (d.stone.setting !== "none" && d.stone.dia > width * 3) checks.push({ level: "warn", text: "Centre stone is very large for this band width" });
  for (const w of model.warnings || []) checks.push({ level: "warn", text: w });
  if (!checks.length) checks.push({ level: "ok", text: "No warnings" });

  const c = CUTS[d.stone.cut];
  return {
    innerDiameter: model.geom.innerDiameter,
    outerDiameter: ro * 2,
    heightMm: ro * 2 + 0.5 + 0.43 * d.stone.dia + 0.16 * d.stone.dia + 0.3,
    metal: { name: metal.label, density, volumeMm3, grossMm3, seatVolumeMm3, weightG },
    parts,
    paveDia: model.paveDia,
    shrink: d.rule.shrink,
    minWall: { shank: sm.mm, rule: minWall },
    thinWalls: walls.map((w) => ({ name: w.name, mm: w.v, at: w.p })),
    stones: stoneList,
    stoneCount: model.stones.length,
    totalCt,
    centre: d.stone.setting === "none" ? null : { cut: d.stone.cut, dia: d.stone.dia, length: d.stone.dia * c.aspect },
    checks,
    ok: !checks.some((x) => x.level === "error"),
  };
}
