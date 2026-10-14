import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { initKernel, solidify } from "../src/kernel.js";
import { parse } from "../src/script.js";
import { build } from "../src/build.js";
import { report } from "../src/report.js";
import { resolveSculpts } from "../src/sculpts.js";
import { TriGrid } from "../src/surface.js";

await initKernel();
const stl = (geo) => {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position.array, n = p.length / 9;
  const bin = new Uint8Array(84 + n * 50), dv = new DataView(bin.buffer);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + t * 50 + 12 + k * 4, p[t * 9 + k], true);
  return bin;
};
// a sculpted ring in millimetres: torus band with a domed head
function ringSculpt() {
  const band = new THREE.TorusGeometry(10, 1.6, 32, 160);
  const head = new THREE.SphereGeometry(4, 48, 32);
  head.scale(1, 0.7, 1);
  head.translate(0, 11.5, 0);
  return stl(mergeGeometries([band, head].map((x) => x.toNonIndexed()).map((x) => (x.deleteAttribute("uv"), x.deleteAttribute("normal"), x))));
}
const files = { "ring.stl": ringSculpt(), "plate.stl": stl(new THREE.BoxGeometry(10, 2, 10, 20, 4, 20)) };
const load = async (src) => (files[src] ? { bytes: files[src], ext: "stl" } : null);
async function make(text) {
  const p = parse(text);
  assert.deepEqual(p.errors, []);
  const sculpts = await resolveSculpts(p.design, load);
  return { design: p.design, model: build(p.design, { sculpts }), sculpts };
}
const BASE = 'design "s"\nring size=US7 metal=18k-yellow\nshank width=3 thickness=1.8 profile=none\nstone cut=round dia=4 setting=none\n';

test("surface pavé covers the painted part of a sculpt, on the surface and facing out", async () => {
  const { model, sculpts } = await make(`${BASE}sculpt id=ring src=ring.stl repair=voxel voxel=0.12\nsurfpave id=p on=ring pts=0:14,0:-2:13.5,0:2:13.5,0 r=3 dia=1.1 gap=0.12 setting=bead`.replace("pts=0:14,0:-2:13.5,0:2:13.5,0", "pts=0:14:0,-2:13.5:0,2:13.5:0"));
  const stones = model.stones.filter((s) => s.role === "surface");
  assert.ok(stones.length >= 12, `only ${stones.length} stones`);
  const grid = [...sculpts.values()][0].grid || new TriGrid([...sculpts.values()][0].geometry);
  for (const s of stones) {
    const girdle = s.pos.clone().addScaledVector(s.normal, 0.05);
    assert.ok(grid.closestPoint(girdle, 1).dist < 0.12, "stone sits on the surface");
    assert.ok(s.normal.dot(new THREE.Vector3(0, 11.5, 0).sub(s.pos).normalize()) < 0, "faces outward");
  }
  const r = report(model);
  assert.ok(!r.checks.some((c) => /overlap/.test(c.text)), JSON.stringify(r.checks));
  assert.ok(model.metal.some((m) => m.name === "beads p"));
  // seats are cut into the sculpt
  const s = solidify(model);
  assert.ok(s.gross - s.volume > 0.3, `seats removed ${s.gross - s.volume}`);
  assert.equal(s.pieces.length, 1);
  assert.ok(report(model, s).ok, JSON.stringify(report(model, s).checks));
  s.free();
});

test("surface pavé never hangs over an edge, and mirrors", async () => {
  const { model } = await make(`${BASE}sculpt id=plate src=plate.stl y=12\nsurfpave id=c on=plate pts=4:13:4 r=3 dia=1.3 gap=0.15 mirror=yes`);
  const stones = model.stones.filter((s) => s.role === "surface");
  assert.ok(stones.length >= 4);
  // the brush is a sphere, so pavé may wrap onto the side faces; what must
  // never happen is a girdle hanging past the face it sits on
  for (const s of stones) {
    const u = new THREE.Vector3(1, 0, 0).cross(s.normal);
    if (u.lengthSq() < 1e-6) u.set(0, 1, 0).cross(s.normal);
    u.normalize();
    const v = s.normal.clone().cross(u);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const g = s.pos.clone().addScaledVector(u, Math.cos(a) * s.dia / 2).addScaledVector(v, Math.sin(a) * s.dia / 2);
      assert.ok(Math.abs(g.x) <= 5.02 && Math.abs(g.y - 12) <= 1.02 && Math.abs(g.z) <= 5.02, `girdle point ${g.toArray()} of stone at ${s.pos.toArray()}`);
    }
  }
  assert.ok(stones.some((s) => s.pos.x < 0) && stones.some((s) => s.pos.x > 0), "mirrored to -x");
});

test("a thin sculpt wall is flagged with its location", async () => {
  const thin = stl(new THREE.BoxGeometry(10, 0.5, 10, 10, 2, 10));
  files["thin.stl"] = thin;
  const { model } = await make(`${BASE}sculpt id=t src=thin.stl\nrule min_wall=0.8 shrink=0`);
  const r = report(model);
  assert.ok(r.checks.some((c) => /sculpt t: wall is 0\.(49|50) mm/.test(c.text)), JSON.stringify(r.checks));
});
