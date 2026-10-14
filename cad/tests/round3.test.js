// Round-3 user-test findings: sculpt fitting, hollow weights, exports with
// sculpts, stricter checks, assistant fractions, and input handling.
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initKernel, solidify } from "../src/kernel.js";
import { prepareSculpt, transformSoup } from "../src/sculpt.js";
import { parse, serialize, defaultDesign } from "../src/script.js";
import { build } from "../src/build.js";
import { report } from "../src/report.js";
import { resolveSculpts, withWall } from "../src/sculpts.js";
import { toGeometry } from "../src/kernel.js";
import { compileDesign, exportDesign } from "../src/exporter.js";
import { interpret } from "../src/assistant.js";
import { readObj } from "../src/meshio.js";
import { TriGrid } from "../src/surface.js";
import { sizeRange } from "../src/export.js";

await initKernel();
const plain = (g) => {
  const x = g.toNonIndexed();
  x.deleteAttribute("uv");
  x.deleteAttribute("normal");
  return x;
};
const soupOf = (...geos) => Float32Array.from(mergeGeometries(geos.map(plain)).attributes.position.array);
const stl = (soup) => {
  const n = soup.length / 9;
  const bin = new Uint8Array(84 + n * 50), dv = new DataView(bin.buffer);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + t * 50 + 12 + k * 4, soup[t * 9 + k], true);
  return bin;
};
// a band (bore 17.2 mm) with a head modelled as a separate closed shell that
// overlaps it, as AI generators often do
const band = () => new THREE.TorusGeometry(10, 1.4, 32, 128);
const head = () => new THREE.SphereGeometry(2.2, 32, 24).translate(0, 11.6, 0);
const ringSoup = () => soupOf(band(), head());
const bore = (manifold) => {
  const m = manifold.getMesh();
  let r = Infinity;
  for (let i = 0; i < m.vertProperties.length; i += m.numProp) r = Math.min(r, Math.hypot(m.vertProperties[i], m.vertProperties[i + 1]));
  return 2 * r;
};
const TARGET = 17.32;

test("fit=ring keeps a head that is a separate overlapping shell, head up", () => {
  const { manifold, info } = prepareSculpt(ringSoup(), { fit: "ring" }, { innerDiameter: TARGET });
  assert.equal(info.pieces, 1, "head and band are one piece");
  assert.ok(!info.removedPieces);
  assert.ok(Math.abs(info.fit.scale - TARGET / 17.2) < 0.003, `scale ${info.fit.scale}`);
  assert.ok(Math.abs(bore(manifold) - TARGET) < 0.02, `bore ${bore(manifold)}`);
  const b = manifold.boundingBox();
  assert.ok(b.max[1] > 13.5 && b.min[1] > -12, "head on top");
  manifold.delete();
});

test("fit=ring works in any units, at any tilt, and ignores a stray piece", () => {
  const cases = {
    micrometres: transformSoup(ringSoup(), { scale: 1000 }),
    tilted: transformSoup(ringSoup(), { rx: 35, ry: -50, rz: 10, x: 30, y: -7 }),
    debris: soupOf(band(), head(), new THREE.SphereGeometry(4, 24, 16).translate(30, 0, 0)),
  };
  for (const [name, soup] of Object.entries(cases)) {
    const { manifold, info } = prepareSculpt(soup, { fit: "ring" }, { innerDiameter: TARGET });
    assert.ok(Math.abs(bore(manifold) - TARGET) < 0.05, `${name}: bore ${bore(manifold)}`);
    const b = manifold.boundingBox();
    assert.ok(b.max[2] - b.min[2] < 4.6 && b.max[0] - b.min[0] > 22, `${name}: finger axis is Z (${b.max[2] - b.min[2]})`);
    assert.ok(b.max[1] > 13.5, `${name}: head up`);
    if (name === "debris") assert.equal(info.removedPieces, 1);
    manifold.delete();
  }
  assert.throws(() => prepareSculpt(soupOf(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))), { fit: "ring" }), /Too few triangles/);
});

test("voxel repair keeps the bore at the ring size and a hollow wall at its thickness", () => {
  const holed = ringSoup().filter((_, i) => Math.floor(i / 9) % 31 !== 5);
  const { manifold, info } = prepareSculpt(Float32Array.from(holed), { fit: "ring" }, { innerDiameter: TARGET });
  assert.equal(info.method, "voxel");
  assert.equal(info.autoClose, 2, "broken meshes get their holes closed by default");
  assert.ok(Math.abs(info.bore - TARGET) < 0.01 && Math.abs(bore(manifold) - TARGET) < 0.12, `bore ${info.bore} / ${bore(manifold)}`);
  manifold.delete();

  const solid = prepareSculpt(soupOf(band()), { fit: "ring", repair: "voxel" }, { innerDiameter: TARGET });
  const hollow = prepareSculpt(soupOf(band()), { fit: "ring", hollow: 0.5 }, { innerDiameter: TARGET });
  // shell of a tube r=1.41 with a wall of at least 0.5 mm (half a voxel is
  // added so no spot comes out thinner): about 1 - (0.835/1.41)^2 of the solid
  const ratio = hollow.manifold.volume() / solid.manifold.volume();
  assert.ok(Math.abs(ratio - (1 - (0.835 / 1.41) ** 2)) < 0.05, `hollow/solid ${ratio}`);
  const prepared = withWall(toGeometry(hollow.manifold), hollow.info);
  assert.ok(prepared.info.minWall.mm >= 0.5 && prepared.info.minWall.mm < 0.62, `wall ${prepared.info.minWall.mm}`);
  solid.manifold.delete();
  hollow.manifold.delete();
});

const files = { "ring.stl": stl(ringSoup()), "plate.stl": stl(soupOf(new THREE.BoxGeometry(10, 0.4, 10, 25, 1, 25))) };
const loadAsset = async (src) => (files[src] ? { bytes: files[src], ext: "stl" } : null);
const BASE = 'design "r3"\nring size=US7 metal=18k-yellow\nshank width=3 thickness=1.8 profile=none\nstone cut=round dia=4 setting=none\n';
const model = async (text) => {
  const { design, errors } = parse(text);
  assert.deepEqual(errors, []);
  return compileDesign(design, { loadAsset });
};

test("a hollow sculpt weighs as a shell in the exact solid", async () => {
  const solid = await model(`${BASE}sculpt id=s src=ring.stl fit=ring`);
  const hollow = await model(`${BASE}sculpt id=s src=ring.stl fit=ring hollow=0.6`);
  assert.ok(hollow.exact.volume < solid.exact.volume * 0.75, `${hollow.exact.volume} vs ${solid.exact.volume}`);
  assert.equal(hollow.exact.pieces.length, 1);
});

test("checks: failed sculpts, no band, band objects without a band, metal in the bore", async () => {
  const failed = report(await model(`${BASE}sculpt id=s src=missing.stl fit=ring`));
  assert.equal(failed.ok, false);
  assert.ok(failed.checks.some((c) => c.level === "error" && /sculpt s could not be used/.test(c.text)));

  const nothing = report(build(parse(BASE).design));
  assert.equal(nothing.ok, false);
  assert.ok(nothing.checks.some((c) => /Nothing goes round the finger/.test(c.text)));

  const accents = report(await model(`${BASE}sculpt id=s src=ring.stl fit=ring\naccent id=side cut=round dia=2 s=7 setting=prong mirror=yes`));
  assert.ok(accents.checks.some((c) => c.level === "error" && /accent side sits on the band/.test(c.text)), JSON.stringify(accents.checks));

  const loose = report(await model(`${BASE}sculpt id=s src=plate.stl x=0 y=12 z=0`));
  assert.ok(loose.checks.some((c) => /No metal goes round the finger/.test(c.text)));

  const fitted = report(await model(`${BASE}sculpt id=s src=ring.stl fit=ring`));
  assert.equal(fitted.ok, true, JSON.stringify(fitted.checks));
  assert.ok(Math.abs(fitted.sculpts.s.boreMeasured - TARGET) < 0.05);
});

test("exports include sculpts; size runs re-fit them per size; no-stone designs export", async () => {
  const text = `${BASE}sculpt id=s src=ring.stl fit=ring\nsurfpave id=p on=s pts=0:13.6:0 r=1.6 dia=1.1 gap=0.12 setting=bead`;
  const { design } = parse(text);
  const m = await compileDesign(design, { loadAsset });
  assert.ok(m.stones.length > 0);
  const stones = await exportDesign(design, text, "stl-stones", { loadAsset, model: m });
  assert.equal(new DataView(stones.bytes.buffer, stones.bytes.byteOffset).getUint32(80, true) % 1, 0);
  assert.ok(stones.bytes.length > 84 + 50 * 8);
  for (const f of ["3mf", "glb", "obj", "bundle"]) assert.ok((await exportDesign(design, text, f, { loadAsset, model: m })).bytes.length > 1000, f);

  const run = await exportDesign(design, text, "sizerun", { loadAsset, sizes: ["US5", "US9"] });
  const names = new TextDecoder().decode(run.bytes).match(/r3_US\d\.stl/g);
  assert.deepEqual([...new Set(names)], ["r3_US5.stl", "r3_US9.stl"]);

  const bare = `${BASE}sculpt id=s src=ring.stl fit=ring`;
  const pb = parse(bare).design;
  await assert.rejects(exportDesign(pb, bare, "stl-stones", { loadAsset }), /no stones/);
  const zip = await exportDesign(pb, bare, "bundle", { loadAsset });
  assert.ok(!new TextDecoder().decode(zip.bytes).includes("stones.stl"));
  await assert.rejects(exportDesign(pb, bare, "stl", { loadAsset, part: "shank" }), /no part named "shank"/);
  await assert.rejects(exportDesign(parse(`${BASE}sculpt id=s src=missing.stl`).design, bare, "stl", { loadAsset }), /could not be used/);
  assert.throws(() => sizeRange("US", 0, 20, 0.5), /US sizes run from 0 to 16/);
  assert.deepEqual(sizeRange("US", 15, 16, 0.5), ["US15", "US15.5", "US16"]);
});

test("surface pavé paints only the side the brush touched", async () => {
  // a 0.4 mm plate: a brush 2 mm wide reaches both faces
  const m = await model(`design "p"\nring size=US7 metal=18k-yellow\nshank width=3 thickness=1.8 profile=comfort\nstone cut=round dia=4 setting=none\nsculpt id=s src=plate.stl y=14\nsurfpave id=p on=s pts=0:14.2:0 r=2 dia=1 gap=0.1 setting=none`);
  const surf = m.stones.filter((s) => s.role === "surface");
  assert.ok(surf.length > 3);
  assert.ok(surf.every((s) => s.normal.y > 0.9), "all on the top face");
});

test("assistant: fractions, quarter sizes and ruling a metal out", () => {
  const d = parse('design "a"\nring size=US7 metal=platinum\nshank width=2 thickness=1.8 profile=comfort\nstone cut=round dia=6 setting=prong prongs=4 tip=claw\n').design;
  assert.ok(Math.abs(interpret("a 1/2 ct oval", d).design.stone.dia - 4.52) < 0.3);
  assert.equal(interpret("US 7 1/4 please", d).design.ring.size, "US7.25");
  const not = interpret("not platinum", d);
  assert.equal(not.design.ring.metal, "platinum");
  assert.ok(not.notes.some((n) => /ruled out/.test(n)));
  assert.equal(interpret("not platinum but palladium", d).design.ring.metal, "palladium");
  const sculpted = parse(`${BASE}sculpt id=s src=ring.stl fit=ring`).design;
  const r = interpret("add side stones and pave", sculpted);
  assert.equal(r.design.accents.length, 0);
  assert.equal(r.design.regions.length, 0);
  assert.equal(r.notes.length, 2);
});

test("inputs: default script, OBJ errors, sculpt paths stay in their folders", async () => {
  assert.ok(!/^pave /m.test(serialize(defaultDesign())), "no pave line until it matters");
  assert.throws(() => readObj("hello\nv 1 2\nf 1 2 9\n"), /OBJ line 2/);
  assert.throws(() => readObj("v 0 0 0\nv 1 0 0\nf 1 2 9\n"), /does not exist/);
  const { loadAsset: load, setBaseDir } = await import("../node/tools.js");
  const dir = mkdtempSync(join(tmpdir(), "jws-r3-"));
  writeFileSync(join(dir, "ok.stl"), files["ring.stl"]);
  setBaseDir(join(dir, "sub"));
  assert.equal(await load("../ok.stl", join(dir, "sub")), null);
  assert.equal(await load(join(dir, "ok.stl"), join(dir, "sub")), null);
  assert.ok(await load("ok.stl", dir));
  // a grid over a mesh in the wrong units stays small
  const huge = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(transformSoup(ringSoup(), { scale: 1000 }), 3));
  assert.ok(new TriGrid(huge).cells.size < 2e6);
});
