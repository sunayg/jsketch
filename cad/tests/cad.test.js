import test from "node:test";
import * as THREE from "three";
import assert from "node:assert/strict";
import { parse, serialize, defaultDesign, setField, TEMPLATES } from "../src/script.js";
import { evalExpr } from "../src/expr.js";
import { weightIn, gemIn, lengthIn } from "../src/units.js";
import { bakeGeometry, to3mf } from "../src/export.js";
import { MELEE_SIZES } from "../src/gems.js";
import { crc32 } from "../src/zip.js";
import { crc32 as nodeCrc32 } from "node:zlib";
import { signedVolume as vol } from "../src/build.js";
import { parseSize, sizeFromDiameter } from "../src/sizes.js";
import { build, signedVolume } from "../src/build.js";
import { report } from "../src/report.js";

test("ring sizes", () => {
  assert.ok(Math.abs(parseSize("US7").innerDiameter - 17.32) < 0.02);
  assert.ok(Math.abs(parseSize("EU54").innerDiameter - 17.19) < 0.01);
  assert.ok(Math.abs(parseSize("JP13").innerDiameter - 16.87) < 0.01);
  assert.equal(parseSize("XX7"), null);
});

test("parse reports line numbers and bad values", () => {
  const { errors } = parse('design "x"\nring size=US99\nstone dia=abc\nfoo bar\nstone cut=round');
  assert.deepEqual(errors.map((e) => e.line), [2, 3, 4, 5]);
  assert.match(errors[0].message, /out of range/);
  assert.match(errors[3].message, /only appear once/);
});

test("serialize round-trips", () => {
  for (const make of Object.values(TEMPLATES)) {
    const d = make();
    const back = parse(serialize(d));
    assert.deepEqual(back.errors, []);
    assert.deepEqual(back.design, d);
  }
});

test("shank weight matches the analytic tube volume", () => {
  const d = defaultDesign();
  d.shank.profile = "flat";
  d.stone.setting = "prong";
  const m = build(d);
  const shank = m.metal.find((x) => x.name === "shank");
  const ri = m.geom.ri, ro = m.geom.ro, w = d.shank.width;
  const exact = Math.PI * (ro * ro - ri * ri) * w;
  const v = Math.abs(signedVolume(shank.geometry));
  // 160-segment polygon approximates the circle from inside
  assert.ok(v < exact && v > exact * 0.99, `${v} vs ${exact}`);
});
test("solitaire report is sane", () => {
  const r = report(build(defaultDesign()));
  assert.ok(r.metal.weightG > 2 && r.metal.weightG < 12, r.metal.weightG);
  assert.equal(r.stoneCount, 1);
  assert.ok(Math.abs(r.totalCt - 1.0) < 0.05); // 6.5 mm round ~ 1 ct
  assert.ok(r.ok);
});

test("halo count grows with centre stone and pavé fills painted area", () => {
  const halo = build(TEMPLATES["Halo ring"]());
  assert.ok(halo.stones.filter((s) => s.role === "halo").length >= 12);
  const pave = build(TEMPLATES["Pavé band"]());
  const n = pave.stones.filter((s) => s.role === "pave").length;
  assert.ok(n > 20, `pave stones: ${n}`);
  assert.equal(report(pave).checks.some((c) => c.level === "error"), false);
});

test("min wall rule flags a thin shank and unstocked melee", () => {
  const d = defaultDesign();
  d.shank.thickness = 0.6;
  d.pave.dia = 1.25;
  d.paint.push({ s: 20, w: 0, r: 2 });
  const r = report(build(d));
  assert.equal(r.ok, false);
  // a 0.6 mm comfort band is thinnest at its chamfered edge (0.6 - 0.2 mm)
  assert.ok(r.checks.some((c) => /shank: wall is 0\.40 mm at \(0\.00, -?[\d.]+, -1\.50\), under the 0\.8 mm minimum/.test(c.text)), JSON.stringify(r.checks));
  assert.ok(r.checks.some((c) => /stocked/.test(c.text)));
});

test("unpainted design has no pavé; pavé keeps clear of the head", () => {
  const d = defaultDesign();
  d.paint.push({ s: 0, w: 0, r: 6 });
  const m = build(d);
  for (const s of m.stones.filter((x) => x.role === "pave")) {
    assert.ok(s.pos.distanceTo(new THREE.Vector3(0, m.geom.ro, 0)) >= d.stone.dia * 0.3);
  }
});

test("expressions: arithmetic, variables, errors", () => {
  assert.equal(evalExpr("1+2*3"), 7);
  assert.equal(evalExpr("(1+2)*3 - -2"), 11);
  assert.equal(evalExpr("a/2", { a: 5 }), 2.5);
  assert.throws(() => evalExpr("1/0"), /zero/);
  assert.throws(() => evalExpr("zz+1"), /Unknown variable/);
  assert.throws(() => evalExpr("process.exit()"), /Cannot read|Unknown/);
  assert.throws(() => evalExpr("2 3"), /Unexpected/);
});

test("variables drive fields and survive a round trip until a field is edited", () => {
  const d = TEMPLATES["Parametric halo"]();
  assert.equal(d.shank.width, 3);
  assert.equal(d.stone.dia, 6);
  assert.equal(d.ring.diameter, 17.35);
  const text = serialize(d);
  assert.match(text, /var stone_d=6/);
  assert.match(text, /shank width=\{stone_d\/2\}/);
  assert.deepEqual(parse(text).design, d);
  setField(d, "stone", "dia", 7);
  assert.match(serialize(d), /stone cut=round dia=7 /); // expression dropped for the edited field
  assert.match(serialize(d), /shank width=\{stone_d\/2\}/); // others keep theirs
  const bad = parse("var a=1\nshank width={b}\npaint s={a}");
  assert.deepEqual(bad.errors.map((e) => e.line), [2, 3]);
});

test("custom ring diameter and density override", () => {
  const d = defaultDesign();
  d.ring.diameter = 18;
  d.ring.density = 10;
  const m = build(d);
  assert.equal(m.geom.innerDiameter, 18);
  const base = defaultDesign();
  const r1 = report(build(base));
  const r2 = report(m);
  assert.equal(r2.metal.density, 10);
  assert.ok(r2.metal.weightG < r1.metal.weightG); // lower density, despite a slightly larger ring
});

test("sizes: DE and IT", () => {
  assert.ok(Math.abs(parseSize("DE54").innerDiameter - 54 / Math.PI) < 1e-9);
  assert.ok(Math.abs(parseSize("IT14").innerDiameter - 54 / Math.PI) < 1e-9);
  assert.equal(parse("ring size=IT99").errors.length, 1);
});

test("auto pavé picks a stocked size and fills the painted area", () => {
  const d = TEMPLATES["Pavé band"]();
  d.pave = { dia: "auto", gap: 0.15, min: 0.9, max: 1.7 };
  const m = build(d);
  assert.ok(MELEE_SIZES.includes(m.paveDia) && m.paveDia >= 0.9 && m.paveDia <= 1.7, String(m.paveDia));
  const n = m.stones.filter((s) => s.role === "pave").length;
  assert.ok(n > 20);
  assert.ok(m.stones.filter((s) => s.role === "pave").every((s) => s.dia === m.paveDia));
  const r = report(m);
  assert.equal(r.checks.some((c) => /stocked/.test(c.text)), false);
  // nothing painted: no size and no noise
  const empty = report(build({ ...defaultDesign(), pave: { dia: "auto", gap: 0.15 } }));
  assert.equal(empty.paveDia, null);
  assert.ok(empty.ok && empty.checks[0].level === "ok", JSON.stringify(empty.checks));
  // painted, but the band is too narrow for any stocked size: say so
  const narrow = defaultDesign();
  narrow.shank.width = 1.2;
  narrow.pave = { dia: "auto", gap: 0.15, min: 0.9, max: 2 };
  narrow.paint.push({ s: 20, w: 0, r: 3 });
  const nr = report(build(narrow));
  assert.equal(nr.stoneCount, 1);
  assert.ok(nr.checks.some((c) => /no stocked melee size fits/.test(c.text)), JSON.stringify(nr.checks));
});

test("stones in the finger bore are flagged", () => {
  const m = build(defaultDesign());
  m.stones.push({ cut: "round", dia: 1.3, role: "pave", pos: new THREE.Vector3(0, -m.geom.ri + 0.2, 0), normal: new THREE.Vector3(0, 1, 0) });
  assert.ok(report(m).checks.some((c) => /finger bore/.test(c.text)));
});

test("units", () => {
  assert.ok(Math.abs(weightIn(31.1034768, "ozt") - 1) < 1e-9);
  assert.ok(Math.abs(weightIn(1.55517384, "dwt") - 1) < 1e-9);
  assert.equal(gemIn(1, "mg"), 200);
  assert.equal(gemIn(1, "pts"), 100);
  assert.equal(lengthIn(25.4, "in"), 1);
});

test("shrinkage scales exports uniformly", () => {
  const m = build(defaultDesign());
  const v0 = Math.abs(vol(bakeGeometry(m, "metal", 0)));
  const v2 = Math.abs(vol(bakeGeometry(m, "metal", 2)));
  assert.ok(Math.abs(v2 / v0 - 1.02 ** 3) < 1e-6);
});

test("3MF package is a valid zip with a millimetre model", () => {
  const m = build(TEMPLATES["Halo ring"]());
  const zip = to3mf(m, 0);
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  // walk local headers; check every CRC against Node's implementation
  let off = 0;
  const names = [];
  while (dv.getUint32(off, true) === 0x04034b50) {
    const size = dv.getUint32(off + 18, true);
    const nl = dv.getUint16(off + 26, true);
    const name = new TextDecoder().decode(zip.subarray(off + 30, off + 30 + nl));
    const data = zip.subarray(off + 30 + nl, off + 30 + nl + size);
    assert.equal(dv.getUint32(off + 14, true), nodeCrc32(data), name);
    assert.equal(crc32(data), nodeCrc32(data));
    names.push(name);
    off += 30 + nl + size;
  }
  assert.deepEqual(names, ["[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"]);
  assert.equal(dv.getUint32(off, true), 0x02014b50); // central directory follows
  const model = new TextDecoder().decode(zip).match(/<model[\s\S]*<\/model>/)[0];
  assert.match(model, /unit="millimeter"/);
  assert.equal((model.match(/<object /g) || []).length, 2);
  const tri = (model.match(/<triangle /g) || []).length;
  assert.ok(tri > 1000);
  // every triangle index is in range
  const nv = (model.match(/<vertex /g) || []).length;
  for (const mm of model.matchAll(/v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)) assert.ok(+mm[1] < nv && +mm[2] < nv && +mm[3] < nv);
});

test("switching sizing system keeps the finger size", () => {
  const d = parseSize("US6.5").innerDiameter;
  assert.equal(sizeFromDiameter("EU", d), "EU53");
  assert.equal(sizeFromDiameter("IT", d), "IT13");
  assert.equal(sizeFromDiameter("US", parseSize("EU53").innerDiameter), "US6.5");
  assert.equal(sizeFromDiameter("JP", d), "JP13");
});
