import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { initKernel, solidify, toGeometry, toManifold } from "../src/kernel.js";
import { parse, defaultDesign } from "../src/script.js";
import { build } from "../src/build.js";
import { report } from "../src/report.js";
import { DESIGNS } from "../src/library.js";
import { openEdges } from "../src/geom.js";
import { stlBytes } from "../src/export.js";

await initKernel();
const plain = () => {
  const d = defaultDesign();
  d.stone.setting = "none";
  d.shank.profile = "flat";
  return d;
};

test("a plain flat band's solid volume matches the tube formula", () => {
  const m = build(plain(), { quality: "fine" });
  const s = solidify(m);
  const { ri, ro, width } = m.geom;
  const exact = Math.PI * (ro * ro - ri * ri) * width;
  assert.ok(Math.abs(s.volume - exact) / exact < 0.001, `${s.volume} vs ${exact}`);
  assert.equal(s.pieces.length, 1);
  s.free();
});

test("seats are cut: flush stones remove metal, and the result stays one watertight piece", () => {
  const d = plain();
  d.regions.push({ id: "z", dia: 1.5, gap: 0.15, setting: "bead", bead: 0.35, mirror: "no", pts: [[-10, -1.4], [10, -1.4], [10, 1.4], [-10, 1.4]] });
  const m = build(d);
  const s = solidify(m);
  assert.ok(s.gross - s.volume > 0.5, `seats removed only ${s.gross - s.volume} mm³`);
  assert.equal(s.pieces.length, 1);
  assert.equal(openEdges(toGeometry(s.solid)), 0);
  const r = report(m, s);
  assert.ok(r.metal.exact && Math.abs(r.metal.volumeMm3 - s.volume) < 1e-9);
  s.free();
});

test("every library design solidifies into one valid piece", () => {
  for (const ex of DESIGNS) {
    const m = build(parse(ex.text).design);
    const s = solidify(m);
    assert.deepEqual(s.invalid, [], ex.name);
    assert.equal(s.pieces.length, 1, `${ex.name}: ${JSON.stringify(s.pieces.map((p) => [p.volume, p.parts]))}`);
    assert.ok(report(m, s).ok, ex.name);
    s.free();
  }
});

test("a detached part is reported as floating metal, with its name", () => {
  const m = build(defaultDesign());
  const ball = new THREE.SphereGeometry(1, 16, 12);
  ball.translate(0, 30, 0);
  m.metal.push({ name: "stray-ball", geometry: ball });
  const s = solidify(m);
  assert.equal(s.pieces.length, 2);
  const r = report(m, s);
  assert.ok(r.checks.some((c) => /not connected/.test(c.text) && /stray-ball/.test(c.text)), JSON.stringify(r.checks));
  s.free();
});

test("whole-piece STL export uses the solid: one watertight shell", () => {
  const m = build(parse(DESIGNS.find((x) => x.name === "Halo ring").text).design);
  const s = solidify(m);
  m.solidGeometry = toGeometry(s.solid);
  s.free();
  const bytes = stlBytes(m, "metal");
  const tris = new DataView(bytes.buffer, bytes.byteOffset).getUint32(80, true);
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(tris * 9);
  const dv = new DataView(bytes.buffer, bytes.byteOffset);
  for (let t = 0; t < tris; t++) for (let k = 0; k < 9; k++) pos[t * 9 + k] = dv.getFloat32(84 + t * 50 + 12 + k * 4, true);
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  assert.equal(openEdges(g), 0);
  const back = toManifold(g);
  assert.equal(back.decompose().length, 1);
  back.delete();
});
