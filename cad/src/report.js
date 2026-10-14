// Measurements and checks from a built model.
import * as THREE from "three";
import { METALS } from "./script.js";
import { CUTS, caratOf, isStockedMelee, outline } from "./gems.js";
import { signedVolume, openEdges } from "./geom.js";
import { shankThicknessAt } from "./build.js";

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
  const flush = model.stones.filter((s) => FLUSH.has(s.role) || (s.role === "accent" && Math.hypot(s.pos.x, s.pos.y) < ro + 0.01));
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
  const bore = model.stones.filter((s) => Math.hypot(s.pos.x, s.pos.y) - inward(s) < ri - 1e-6);
  if (bore.length) checks.push({ level: "error", text: `${bore.length} stone(s) intrude into the finger bore` });

  const onBand = model.stones.filter((s) => s.w !== undefined && s.role !== "centre");
  const over = onBand.filter((s) => Math.abs(s.w) + (s.dia * (CUTS[s.cut].aspect > 1 ? 1 : 1)) / 2 > width / 2 + 0.01);
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
  if (d.stone.dia > width * 3) checks.push({ level: "warn", text: "Centre stone is very large for this band width" });
  if (d.pave.dia === "auto" && model.paveDia == null) {
    checks.push({ level: "warn", text: d.paint.length ? "Auto pavé found no stocked melee size that fits the painted area" : "Auto pavé has no painted area yet" });
  }
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
    centre: { cut: d.stone.cut, dia: d.stone.dia, length: d.stone.dia * c.aspect },
    checks,
    ok: !checks.some((x) => x.level === "error"),
  };
}
