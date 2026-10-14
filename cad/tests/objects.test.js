import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { parse, defaultDesign } from "../src/script.js";
import { build } from "../src/build.js";
import { report } from "../src/report.js";
import { CUTS, stoneGeometry, caratOf } from "../src/gems.js";
import { signedVolume, openEdges } from "../src/geom.js";

const design = (lines) => {
  const r = parse(`ring size=US7 metal=platinum\nshank width=4 thickness=1.9 profile=flat\n${lines}`);
  assert.deepEqual(r.errors, []);
  return r.design;
};
const roles = (m, role) => m.stones.filter((s) => s.role === role);

test("every cut builds a closed stone with positive volume and a sane carat", () => {
  for (const cut of Object.keys(CUTS)) {
    const g = stoneGeometry(cut, 6);
    assert.equal(openEdges(g), 0, cut);
    assert.ok(signedVolume(g) > 0, cut);
    const ct = caratOf(cut, 6);
    // 6 mm wide: rounds are ~1.6 ct, long cuts like baguettes run higher
    assert.ok(ct > 0.5 && ct < 4.5, `${cut}: ${ct}`);
  }
});

test("accent mirrors to the other shoulder", () => {
  const m = build(design("accent id=side cut=pear dia=2.5 s=13 setting=bezel mirror=yes"));
  const a = roles(m, "accent");
  assert.equal(a.length, 2);
  assert.ok(Math.abs(a[0].pos.x + a[1].pos.x) < 1e-9 && Math.abs(a[0].pos.y - a[1].pos.y) < 1e-9);
  assert.ok(m.metal.some((p) => p.name.startsWith("side~mirror")));
});

test("stroke packs by count or by size, with beads or a channel", () => {
  const byCount = build(design("stroke id=r pts=15:0,27:0 count=8 setting=bead"));
  const st = roles(byCount, "stroke");
  assert.equal(st.length, 8);
  assert.ok(Math.abs(st[0].dia - (12 / 8 - 0.15)) < 1e-9);
  assert.ok(byCount.metal.some((p) => p.name === "beads r"));
  const bySize = build(design("stroke id=r pts=15:0,27:0 dia=1.5 gap=0.2 setting=channel mirror=yes"));
  assert.equal(roles(bySize, "stroke").length, 2 * Math.floor((12 + 0.2) / 1.7));
  assert.ok(bySize.metal.some((p) => p.name === "channel r"));
  assert.ok(report(bySize).ok, JSON.stringify(report(bySize).checks));
});

test("region fills its outline and avoids stones already there", () => {
  const solo = build(design("region id=z pts=10:-1.5,25:-1.5,25:1.5,10:1.5 dia=1.3"));
  const n = roles(solo, "region").length;
  assert.ok(n >= 9, String(n)); // a 4 mm band fits one row of 1.3 mm stones
  for (const s of roles(solo, "region")) assert.ok(s.s >= 10 - 0.01 && s.s <= 25 + 0.01 && Math.abs(s.w) <= 1.5 + 0.01);
  const shared = build(design("stroke id=r pts=12:0,23:0 dia=1.5 setting=bead\nregion id=z pts=10:-1.5,25:-1.5,25:1.5,10:1.5 dia=1.3"));
  assert.ok(roles(shared, "region").length < n);
  assert.equal(report(shared).checks.some((c) => /overlap/.test(c.text)), false);
});

test("halo kinds and head settings build watertight metal", () => {
  for (const kind of ["single", "double", "hidden"]) {
    const d = defaultDesign();
    d.halo = { dia: 1.1, gap: 0.1, kind };
    const r = report(build(d));
    assert.ok(r.ok, `${kind}: ${JSON.stringify(r.checks)}`);
    if (kind === "double") assert.ok(r.stones.some((g) => g.role === "halo2"));
  }
  for (const setting of ["prong", "bezel", "illusion"]) {
    for (const tip of ["round", "pointed", "flat", "claw"]) {
      const d = defaultDesign();
      Object.assign(d.stone, { setting, tip, cut: "emerald" });
      const r = report(build(d));
      assert.ok(r.ok, `${setting}/${tip}: ${JSON.stringify(r.checks)}`);
    }
  }
});

test("checks catch real holes, overhangs and loose stones", () => {
  const m = build(defaultDesign());
  const holed = m.metal[0].geometry.toNonIndexed();
  const pos = holed.attributes.position;
  const cut = new THREE.BufferGeometry();
  cut.setAttribute("position", new THREE.Float32BufferAttribute(Array.from(pos.array).slice(0, pos.array.length - 9 * 4), 3));
  m.metal.push({ name: "broken", geometry: cut });
  assert.ok(report(m).checks.some((c) => /broken: \d+ open edge/.test(c.text)));

  const over = build(design("stroke id=edge pts=15:1.6,25:1.6 dia=1.3 setting=bead"));
  assert.ok(report(over).checks.some((c) => /overhang/.test(c.text)));

  const loose = build(design("region id=z pts=10:-1.5,25:-1.5,25:1.5,10:1.5 dia=1.3 setting=none"));
  assert.ok(report(loose).checks.some((c) => /no beads, prongs or channel/.test(c.text)));
});

test("flush seats come out of the metal weight", () => {
  const r = report(build(design("region id=z pts=10:-1.5,25:-1.5,25:1.5,10:1.5 dia=1.3")));
  assert.ok(r.metal.seatVolumeMm3 > 0);
  assert.ok(r.metal.volumeMm3 < r.metal.grossMm3);
});

test("parse errors for named objects", () => {
  const r = parse("accent id=a\naccent id=a\nstroke id=s pts=1:1\nregion id=r pts=a:b\nregion pts=1:1,2:2,3:3\naccent id=9x");
  assert.deepEqual(r.errors.map((e) => e.line), [2, 3, 4, 5, 6]);
});
