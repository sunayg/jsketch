// Round-5 user-test findings: one way to size a sculpt ring everywhere,
// size runs that check every size, low-poly fits, assistant metals, bundles.
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initKernel } from "../src/kernel.js";
import { parse } from "../src/script.js";
import { report } from "../src/report.js";
import { compileDesign, exportDesign } from "../src/exporter.js";
import { interpret } from "../src/assistant.js";
import { radialShift, radialUnshift } from "../src/resize.js";

await initKernel();
// node/tools.js writes into the assets folder: keep it out of the repo
process.env.JEWELSCRIPT_ASSETS = mkdtempSync(join(tmpdir(), "jws-r5-assets-"));
const T = await import("../node/tools.js");
const plain = (g) => {
  const x = g.toNonIndexed();
  x.deleteAttribute("uv");
  x.deleteAttribute("normal");
  return x;
};
const stl = (...geos) => {
  const p = mergeGeometries(geos.map(plain)).attributes.position.array, n = p.length / 9;
  const bin = new Uint8Array(84 + n * 50), dv = new DataView(bin.buffer);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + t * 50 + 12 + k * 4, p[t * 9 + k], true);
  return bin;
};
const files = {
  "ring.stl": stl(new THREE.TorusGeometry(10, 1.4, 32, 128), new THREE.SphereGeometry(2.2, 32, 24).translate(0, 11.6, 0)),
  "coarse.stl": stl(new THREE.TorusGeometry(10, 1.4, 16, 48), new THREE.SphereGeometry(2.2, 12, 8).translate(0, 11.6, 0)),
  "head.stl": stl(new THREE.SphereGeometry(2.4, 32, 24)),
};
const loadAsset = async (src) => (files[src] ? { bytes: files[src], ext: "stl" } : null);
const HEAD = 'design "r5"\nring size=US7 metal=18k-yellow\nshank width=3 thickness=1.8 profile=none\nstone cut=round dia=4 setting=none\n';
const PAVE = "surfpave id=p on=s pts=0:13.6:0,1.5:13.2:0.5 r=1.8 dia=1.1 gap=0.12 setting=bead\n";
const build = async (text, opts = {}) => {
  const { design, errors } = parse(text);
  assert.deepEqual(errors, []);
  return compileDesign(design, { loadAsset, ...opts });
};

test("a sculpt fitted at one size is resized the same way in the editor and in size runs", async () => {
  const at7 = `${HEAD}sculpt id=s src=ring.stl fit=ring at=US7\n${PAVE}`;
  const base = await build(at7);
  const editor = await build(at7.replace("size=US7", "size=US13"));
  const run = await build(at7.replace("size=US7", "size=US13"), { baseInner: 999 }); // at= wins over a run's fallback
  assert.ok(Math.abs(editor.exact.volume - run.exact.volume) < 1e-6);
  // the piece grows by shank metal only, not by scaling (the old editor gave ~2.4x)
  assert.ok(editor.exact.volume / base.exact.volume < 1.25, `${editor.exact.volume} vs ${base.exact.volume}`);
  // the same stones at both sizes, moved with the metal
  const ct = (m) => m.stones.map((s) => s.dia).sort().join();
  assert.equal(ct(editor), ct(base));
  assert.ok(base.stones.length > 3);
  const r = report(editor, editor.exact);
  assert.ok(!r.checks.some((c) => /intrude|not connected/.test(c.text)), JSON.stringify(r.checks));
  // walls are measured again on the resized sculpt
  assert.ok(editor.sculptInfo.s.minWall.mm !== base.sculptInfo.s.minWall.mm || editor.sculptInfo.s.resizedBy);
  // and a click on the resized sculpt maps back to where it was painted
  const [x, y] = radialShift(3, 12, 1.2, 8.66);
  const [bx, by] = radialUnshift(x, y, 1.2, 8.66);
  assert.ok(Math.hypot(bx - 3, by - 12) < 1e-6);
});

test("size runs move a placed head with the band and refuse sizes that fail the checks", async () => {
  const banded = 'design "hb"\nring size=US7 metal=18k-yellow\nshank width=3 thickness=1.8 profile=comfort\nstone cut=round dia=4 setting=none\nsculpt id=h src=head.stl y=11.4\n';
  const { design } = parse(banded);
  assert.equal(report(await build(banded)).ok ?? true, true);
  const zip = await exportDesign(design, banded, "sizerun", { loadAsset, sizes: ["US4", "US12"] });
  assert.ok(zip.bytes.length > 1000, "the head rides on the band at both sizes");
  const floating = banded.replace("y=11.4", "x=30");
  await assert.rejects(exportDesign(parse(floating).design, floating, "sizerun", { loadAsset, sizes: ["US5", "US6"] }), /fail the checks: US5: .*not connected/);
});

test("low-poly rings fit on the true axis and count as going round the finger", async () => {
  const m = await build(`${HEAD}sculpt id=s src=coarse.stl fit=ring`);
  const info = m.sculptInfo.s;
  assert.deepEqual(info.fit.fingerAxis.map((v) => Math.abs(v)), [0, 0, 1]);
  const r = report(m, m.exact);
  assert.equal(r.ok, true, JSON.stringify(r.checks));
});

test("assistant: ruling out the current metal, and choosing another after a 'no'", () => {
  const d = parse('design "a"\nring size=US7 metal=18k-white\nshank width=2 thickness=1.8 profile=comfort\nstone cut=round dia=6 setting=prong prongs=4 tip=claw\n').design;
  const not = interpret("not white gold", d);
  assert.equal(not.design.ring.metal, "18k-white");
  assert.equal(not.changes.length, 0);
  assert.ok(not.notes.some((n) => /ruled out 18k white gold/.test(n)));
  const swap = interpret("not platinum but palladium", d);
  assert.equal(swap.design.ring.metal, "palladium");
  assert.equal(swap.notes.length, 0);
  assert.equal(interpret("no white gold, use 18k yellow gold", d).design.ring.metal, "18k-yellow");
});

test("bundles open again: the zip reader and the stone list by object", async () => {
  const text = `${HEAD}sculpt id=s src=ring.stl fit=ring at=US7\n${PAVE}`;
  const { bytes } = await exportDesign(parse(text).design, text, "bundle", { loadAsset });
  const files2 = T.readZip(bytes);
  assert.ok(files2["design.jws"] && files2["ring.stl"]);
  assert.equal(files2["ring.stl"].length, files["ring.stl"].length);
  const dir = mkdtempSync(join(tmpdir(), "jws-r5-"));
  writeFileSync(join(dir, "b.zip"), bytes);
  const opened = await T.openBundle(join(dir, "b.zip"));
  assert.deepEqual(opened.meshesCopied, ["ring.stl"]);
  const m = await build(text);
  assert.ok(report(m, m.exact).stones.every((g) => g.role !== "surface" || g.obj === "p"));
});
