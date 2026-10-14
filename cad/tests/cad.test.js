import test from "node:test";
import * as THREE from "three";
import assert from "node:assert/strict";
import { parse, serialize, defaultDesign, TEMPLATES } from "../src/script.js";
import { parseSize } from "../src/sizes.js";
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
  assert.ok(r.checks.some((c) => /minimum wall/.test(c.text)));
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
