import test from "node:test";
import assert from "node:assert/strict";
import { parse, serialize, mergeText, defaultDesign } from "../src/script.js";
import { build } from "../src/build.js";
import { report } from "../src/report.js";
import { interpret } from "../src/assistant.js";

const design = (lines) => {
  const r = parse(`ring size=US7 metal=platinum\n${lines}`);
  assert.deepEqual(r.errors, []);
  return r.design;
};
const checks = (d) => report(build(d)).checks.map((c) => c.text);

test("assistant: negation, fractions, unstocked alloys, refusals", () => {
  const base = defaultDesign();
  base.halo = { dia: 1.2, gap: 0.1 };
  assert.equal(interpret("remove the halo", base).design.halo, null);
  assert.equal(interpret("without a halo please", base).design.halo, null);
  assert.equal(interpret("size 6 and a half", base).design.ring.size, "US6.5");
  assert.equal(interpret("size 6½", base).design.ring.size, "US6.5");
  const half = interpret("half carat round", base);
  assert.ok(Math.abs(half.design.stone.dia - 5.16) < 0.02);
  assert.equal(interpret("change prongs to 6", base).design.stone.prongs, 6);
  assert.equal(interpret("pavé shoulders", base).design.regions.length, 1);
  const white9 = interpret("9k white gold", base);
  assert.equal(white9.design.ring.metal, base.ring.metal);
  assert.match(white9.notes[0], /not in the alloy list/);
  const big = interpret("make it size 99 with a 20 ct round", base);
  assert.equal(big.design.ring.size, "US7");
  assert.equal(big.design.stone.dia, 6.5);
  assert.equal(big.notes.length, 2);
  assert.deepEqual(parse(serialize(big.design)).errors, []);
});

test("stroke count that cannot fit is reduced, not overlapped; count with dia is an error", () => {
  const d = design("shank width=3 thickness=1.8 profile=flat\nstone cut=round dia=4 setting=none\nstroke id=r pts=8:0,20:0 count=40 setting=bead");
  const m = build(d);
  const n = m.stones.filter((s) => s.role === "stroke").length;
  assert.ok(n > 5 && n < 40, String(n));
  const r = report(m);
  assert.ok(!r.checks.some((c) => /overlap/.test(c.text)), JSON.stringify(r.checks));
  assert.ok(r.checks.some((c) => /don't fit/.test(c.text)));
  assert.match(parse("stroke id=r pts=1:0,9:0 count=5 dia=1.3").errors[0].message, /not both/);
});

test("stones hitting halo posts, bezels or raised accents are caught", () => {
  // shoulder pavé painted where the halo's posts land: fills step around them
  const posts = build(design("shank width=3 thickness=1.8 profile=flat\nstone cut=round dia=6 setting=prong prongs=4\nhalo dia=1.2 gap=0.1\npaint s=4.4 w=0 r=1.5"));
  assert.ok(!report(posts).checks.some((c) => /run into the metal/.test(c.text)));
  // a stone added by hand where a post is IS reported
  const pst = posts.colliders.find((c) => c.obj === "halo" && !c.type);
  posts.stones.push({ cut: "round", dia: 1.3, role: "pave", obj: "pave", pos: pst.b.clone(), normal: pst.b.clone().normalize(), s: 0, w: 0 });
  assert.ok(report(posts).checks.some((c) => /run into the metal/.test(c.text)));
  // a stroke passing under a bezel head leaves those stones out, and says so
  const bz = build(design("shank width=4 thickness=1.8 profile=flat\nstone cut=round dia=6 setting=bezel\nstroke id=r pts=-4:0,4:0 dia=1.3 setting=bead"));
  assert.ok(report(bz).checks.some((c) => /left out where the path runs into the head/.test(c.text)));
  assert.ok(!report(bz).checks.some((c) => /run into the metal/.test(c.text)));
  // band stones beside a bezel accent are kept out of its wall
  const m = build(design("shank width=6 thickness=1.8 profile=flat\nstone cut=round dia=4 setting=none\naccent id=a cut=round dia=3 s=10 w=0 setting=bezel\nstroke id=r pts=4:2.2,16:2.2 dia=1.1 setting=bead"));
  const hits = report(m).checks.filter((c) => /run into the metal/.test(c.text));
  assert.equal(hits.length, 0, "stroke stones were placed clear of the bezel");
  // a big raised accent sinking its culet into a thin band
  assert.ok(checks(design("shank width=8 thickness=1.6 profile=flat\nstone cut=round dia=4 setting=none\naccent id=big cut=round dia=8 s=0 setting=bezel")).some((t) => /under the culet/.test(t)));
});

test("hidden halo with many prongs warns when most stones are blocked", () => {
  const d = design("shank width=3 thickness=1.8 profile=comfort\nstone cut=round dia=6 setting=prong prongs=6\nhalo dia=1.2 gap=0.1 kind=hidden");
  assert.ok(checks(d).some((t) => /blocked by prongs/.test(t)));
});

test("UI edits don't add default lines the script never had", () => {
  const text = 'design "x"\nring size=US7 metal=18k-yellow\nshank width=3 thickness=1.8 profile=comfort\nstone cut=round dia=6.5 setting=prong prongs=4\n';
  const d = parse(text).design;
  d.ring.metal = "platinum";
  const out = mergeText(text, d);
  assert.ok(!/^pave /m.test(out) && !/^rule /m.test(out), out);
});

test("accent turn spins the stone (pears can point outward)", () => {
  const m = build(design("shank width=3 thickness=1.8 profile=flat\nstone cut=round dia=6 setting=prong\naccent id=p cut=pear dia=3 s=8 setting=prong prongs=3 turn=90 mirror=yes"));
  const acc = m.stones.filter((s) => s.role === "accent");
  assert.deepEqual(acc.map((s) => s.turn), [90, -90]);
});
