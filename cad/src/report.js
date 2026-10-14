// Measurements and checks from a built model.
import * as THREE from "three";
import { METALS } from "./script.js";
import { CUTS, caratOf, isStockedMelee, outline } from "./gems.js";
import { signedVolume, openEdges } from "./geom.js";
import { shankThicknessAt, EDGE } from "./build.js";
import { hitsMetal } from "./clearance.js";

const FLUSH = new Set(["pave", "region", "stroke", "surface"]);

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

// `exact` (optional) comes from kernel.solidify(): the true volume of the
// unioned metal with seats cut, and its separate pieces. Without it the
// report estimates (sum of parts minus approximate seats).
export function report(model, exact = null) {
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
  const sumMm3 = [...partVolumes.values()].reduce((a, b) => a + b, 0);
  const grossMm3 = exact ? exact.gross : sumMm3;
  const volumeMm3 = exact ? exact.volume : Math.max(0, sumMm3 - seatVolumeMm3);
  const weightG = (volumeMm3 / 1000) * density;
  const parts = [...partVolumes.entries()].map(([obj, v]) => ({ obj, volumeMm3: v, weightG: (v / 1000) * density }));

  const groups = new Map();
  for (const s of model.stones) {
    const dia = Math.round(s.dia * 100) / 100;
    // named objects (side stones, rows, regions, sculpt pavé) are listed by id
    const obj = ["accent", "stroke", "region", "surface"].includes(s.role) ? String(s.obj).split("~")[0] : undefined;
    const key = `${s.role}|${obj ?? ""}|${s.cut}|${dia}`;
    groups.set(key, { role: s.role, ...(obj ? { obj } : {}), cut: s.cut, dia, count: (groups.get(key)?.count || 0) + 1, each: caratOf(s.cut, s.dia) });
  }
  const stoneList = [...groups.values()].map((g) => ({ ...g, total: g.count * g.each }));
  const totalCt = stoneList.reduce((s, g) => s + g.total, 0);

  const checks = [];
  const at = (p) => `(${p.map((v) => v.toFixed(2)).join(", ")})`;
  const minWall = d.rule.min_wall;

  // walls: the shank's thinnest point, then every part with a known thickness
  const sm = model.hasBand === false ? { mm: Infinity, w: 0 } : shankMinWall(d, model.geom);
  const thin = [
    ...(Number.isFinite(sm.mm) ? [{ name: "shank", v: sm.mm, p: [0, -(ri + ro) / 2, sm.w] }] : []),
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
  if (exact) {
    for (const name of exact.invalid) checks.push({ level: "error", text: `${name} is not a valid solid` });
    for (const p of exact.pieces.slice(1)) {
      checks.push({ level: "error", text: `A ${p.volume.toFixed(2)} mm³ piece of metal near (${p.center.map((v) => v.toFixed(1)).join(", ")}) is not connected to the rest${p.parts.length ? ` (${p.parts.slice(0, 3).join(", ")})` : ""}` });
    }
  }
  // without the kernel: every part must touch the shank through a chain of
  // parts (bounding boxes, slightly grown, must overlap; a coarse test)
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
  const floating = exact ? [] : model.metal.filter((_, i) => !reached.has(i));
  for (const m of floating) checks.push({ level: "error", text: `${m.name} is not connected to the rest of the metal` });

  // sculpts: does one go round the finger, and does any reach into the hole
  const SECT = 72;
  let encircled = model.hasBand !== false;
  for (const m of model.metal.filter((x) => x.sculpt)) {
    const p = m.geometry.attributes.position.array;
    const seen = new Uint8Array(SECT);
    let rmin = Infinity;
    const sector = (a) => Math.min(SECT - 1, Math.floor(((a + Math.PI) / (2 * Math.PI)) * SECT));
    for (let i = 0; i < p.length; i += 3) rmin = Math.min(rmin, Math.hypot(p[i], p[i + 1]));
    // every sector a triangle spans counts (a coarse mesh has few corners)
    for (let t = 0; t < p.length; t += 9) {
      const a = [0, 3, 6].map((o) => Math.atan2(p[t + o + 1], p[t + o])).sort((x, y) => x - y);
      if (a[2] - a[0] > Math.PI) continue; // straddles the -x axis: corners suffice
      for (let k = sector(a[0]); k <= sector(a[2]); k++) seen[k] = 1;
    }
    for (let i = 0; i < p.length; i += 3) seen[sector(Math.atan2(p[i + 1], p[i]))] = 1;
    if (seen.reduce((a, v) => a + v, 0) >= SECT * 0.9 && rmin > ri * 0.5) encircled = true;
    const info = model.sculptInfo?.[m.obj];
    if (info) info.boreMeasured = +(2 * rmin).toFixed(3);
    if (rmin < ri - 0.15) checks.push({ level: rmin < ri * 0.5 ? "error" : "warn", text: `${m.name} reaches ${(ri - rmin).toFixed(2)} mm into the finger hole (${(2 * rmin).toFixed(2)} mm across at its narrowest, against ${(2 * ri).toFixed(2)} mm)` });
  }
  if (!encircled && model.metal.some((x) => x.sculpt)) checks.push({ level: "error", text: "No metal goes round the finger: shank profile is none and no sculpt surrounds the finger hole (use fit=ring)" });
  for (const e of model.errors || []) checks.push({ level: "error", text: e });

  // stones that run into the metal of another setting
  let hits = 0;
  for (const st of model.stones) {
    if (hitsMetal(st.pos, (st.dia / 2) * 0.95, model.colliders || [], st.role === "centre" ? "stone" : st.obj)) hits++;
  }
  if (hits) checks.push({ level: "error", text: `${hits} stone(s) run into the metal of another setting (prongs, bezel, posts)` });

  // band-set stones: metal under the culet, metal at the edge, and spacing
  const set = model.stones.filter((s) => s.w !== undefined && (FLUSH.has(s.role) || s.flush));
  const raised = model.stones.filter((s) => s.role === "accent" && !s.flush && s.culetDepth > 0 && s.w !== undefined);
  const under = [
    ...set.map((s) => shankThicknessAt(d, model.geom, s.w) - 0.43 * s.dia - 0.05),
    ...raised.map((s) => shankThicknessAt(d, model.geom, s.w) - s.culetDepth),
    ...model.stones.filter((s) => s.role === "surface" && s.metalBelow !== null && s.metalBelow !== undefined).map((s) => s.metalBelow),
  ];
  const thinUnder = under.filter((v) => v < 0.3);
  if (thinUnder.length) checks.push({ level: "warn", text: `${thinUnder.length} set stone(s) leave only ${Math.max(0, Math.min(...thinUnder)).toFixed(2)} mm of metal under the culet (aim for 0.3 mm or more)` });
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
  for (const [id, info] of Object.entries(model.sculptInfo || {})) {
    if (info.minWall && info.minWall.mm < minWall) {
      checks.push({ level: "error", text: `sculpt ${id}: wall is ${info.minWall.mm.toFixed(2)} mm at (${info.minWall.at.map((v) => v.toFixed(2)).join(", ")}), under the ${minWall} mm minimum; thicken it or hollow less` });
    }
    if (info.speck && info.speck.mm < minWall && !(info.minWall && info.minWall.mm < minWall)) {
      checks.push({ level: "warn", text: `sculpt ${id} has tiny fins or flakes as thin as ${info.speck.mm.toFixed(2)} mm, e.g. at (${info.speck.at.map((v) => v.toFixed(2)).join(", ")}), too small to cast; smooth=1 or repair=voxel removes most of them` });
    }
    if (info.unscaled) checks.push({ level: "warn", text: `sculpt ${id} is ${Math.max(...info.sizeBeforeRepair).toFixed(1)} mm across, which does not look like millimetres: use fit=ring or set scale=` });
    if (info.cavities) checks.push({ level: "warn", text: `sculpt ${id} is hollow with ${info.cavities === 1 ? "a closed cavity" : `${info.cavities} closed cavities`}: add a vent or drain hole before casting or printing` });
    if (info.removedPieces && info.removedVolume > 0.05 * info.volume) checks.push({ level: "warn", text: `sculpt ${id}: removed ${info.removedPieces} loose piece(s), ${info.removedVolume} mm³ (${Math.round((100 * info.removedVolume) / info.volume)}% of what was kept); if that was meant to be part of the ring, use keep=all or join it to the rest` });
    else if (info.removedPieces) checks.push({ level: "info", text: `sculpt ${id}: removed ${info.removedPieces} loose piece(s), ${info.removedVolume} mm³ in all` });
    if (info.autoClose) checks.push({ level: "info", text: `sculpt ${id}: holes in the mesh were closed (close=${info.autoClose}${info.autoSmooth ? `, smooth=${info.autoSmooth}` : ""}); set close= and smooth= to change it` });
    if (info.notWatertight && info.method === "voxel") checks.push({ level: "info", text: `sculpt ${id} was not watertight; rebuilt as a solid (voxel ${info.voxel.toFixed(2)} mm)` });
  }
  if (!checks.some((c) => c.level === "error" || c.level === "warn")) checks.unshift({ level: "ok", text: "No warnings" });

  const c = CUTS[d.stone.cut];
  return {
    innerDiameter: model.geom.innerDiameter,
    outerDiameter: ro * 2,
    heightMm: ro * 2 + 0.5 + 0.43 * d.stone.dia + 0.16 * d.stone.dia + 0.3,
    metal: { name: metal.label, density, volumeMm3, grossMm3, seatVolumeMm3: exact ? exact.gross - exact.volume : seatVolumeMm3, weightG, exact: !!exact },
    parts,
    paveDia: model.paveDia,
    shrink: d.rule.shrink,
    minWall: { shank: Number.isFinite(sm.mm) ? sm.mm : null, rule: minWall },
    sculpts: model.sculptInfo || {},
    thinWalls: walls.map((w) => ({ name: w.name, mm: w.v, at: w.p })),
    stones: stoneList,
    stoneCount: model.stones.length,
    totalCt,
    centre: d.stone.setting === "none" ? null : { cut: d.stone.cut, dia: d.stone.dia, length: d.stone.dia * c.aspect },
    checks,
    ok: !checks.some((x) => x.level === "error"),
  };
}
