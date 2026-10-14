// Round-4 user-test findings: size runs keep a sculpt's head and section,
// bundles carry their sculpt meshes, surface pavé stays out of the bore.
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { initKernel } from "../src/kernel.js";
import { parse } from "../src/script.js";
import { report } from "../src/report.js";
import { compileDesign, exportDesign } from "../src/exporter.js";
import { resolveSculpts } from "../src/sculpts.js";
import { interpret } from "../src/assistant.js";
import { parseSize } from "../src/sizes.js";

await initKernel();
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
const files = { "ring.stl": stl(new THREE.TorusGeometry(10, 1.4, 32, 128), new THREE.SphereGeometry(2.2, 32, 24).translate(0, 11.6, 0)) };
const loadAsset = async (src) => (files[src] ? { bytes: files[src], ext: "stl" } : null);
const BASE = 'design "r4"\nring size=US7 metal=18k-yellow\nshank width=3 thickness=1.8 profile=none\nstone cut=round dia=4 setting=none\nsculpt id=s src=ring.stl fit=ring\n';

test("size runs open or close only the bore of a fitted sculpt", async () => {
  const base = parse(BASE).design;
  const baseInner = 17.3196;
  const at = async (size) => {
    const d = parse(BASE.replace("US7", size)).design;
    const got = [...(await resolveSculpts(d, loadAsset, { baseInner })).values()][0];
    got.geometry.computeBoundingBox();
    return got.geometry.boundingBox;
  };
  const [small, big] = [await at("US5"), await at("US13")];
  const dz = (b) => b.max.z - b.min.z;
  assert.ok(Math.abs(dz(small) - dz(big)) < 1e-3, "band width (along the finger) unchanged");
  // the head's height above the band and the band's section are unchanged:
  // the outer size grows by exactly the bore's growth
  const growth = (big.max.x - big.min.x) - (small.max.x - small.min.x);
  const boreGrowth = parseSize("US13").innerDiameter - parseSize("US5").innerDiameter;
  assert.ok(Math.abs(growth - boreGrowth) < 0.05, `${growth} vs ${boreGrowth}`);
  // the finger hole stays round at both sizes
  for (const [size, b] of [["US5", small], ["US13", big]]) {
    const d = parse(BASE.replace("US7", size)).design;
    const g = [...(await resolveSculpts(d, loadAsset, { baseInner })).values()][0].geometry.attributes.position.array;
    const radii = [];
    for (let i = 0; i < g.length; i += 3) radii.push(Math.hypot(g[i], g[i + 1]));
    const want = parseSize(size).innerDiameter / 2;
    const near = radii.filter((r) => r < want + 0.3);
    assert.ok(Math.min(...near) > want - 0.06, `${size}: bore ${2 * Math.min(...near)} vs ${2 * want}`);
    assert.ok(b);
  }

  // the zip has one STL per size, and surface pavé follows the surface
  const text = `${BASE}surfpave id=p on=s pts=0:13.6:0 r=1.6 dia=1.1 gap=0.12 setting=bead`;
  const d = parse(text).design;
  const counts = [];
  for (const size of ["US5", "US13"]) {
    const ds = structuredClone(d);
    ds.ring.size = size;
    const dr = (parseSize(size).innerDiameter - baseInner) / 2;
    ds.surfpaves[0].pts = ds.surfpaves[0].pts.map(([x, y, z]) => [x, y + dr, z]); // at the top: lifted
    counts.push((await compileDesign(ds, { loadAsset, baseInner })).stones.length);
  }
  assert.equal(counts[0], counts[1], `same pavé at both sizes: ${counts}`);
  const run = await exportDesign(base, BASE, "sizerun", { loadAsset, sizes: ["US5", "US13"] });
  assert.equal(new TextDecoder().decode(run.bytes).match(/r4_US\d+\.stl/g).length >= 2, true);
});

test("a bundle carries the sculpt meshes its script uses", async () => {
  const { bytes } = await exportDesign(parse(BASE).design, BASE, "bundle", { loadAsset });
  const names = new TextDecoder("latin1").decode(bytes);
  assert.ok(names.includes("ring.stl") && names.includes("design.jws"));
});

test("surface pavé brushed over the inner edge stays out of the finger hole", async () => {
  // a dab on the inner side of the band, right at the bore
  const text = `${BASE}surfpave id=p on=s pts=0:-8.8:1.0,2:-8.6:1.0,-2:-8.6:1.0 r=2.5 dia=1 gap=0.1 setting=none`;
  const m = await compileDesign(parse(text).design, { loadAsset });
  const r = report(m, m.exact);
  assert.ok(!r.checks.some((c) => /intrude into the finger bore/.test(c.text)), JSON.stringify(r.checks));
});

test("leftovers: scale with fit=ring, metal notes, hollow vents, big debris", async () => {
  assert.match(parse(BASE.replace("fit=ring", "fit=ring scale=0.95")).errors[0].message, /scale= has no effect with fit=ring/);
  const d = parse(BASE).design;
  assert.ok(interpret("not platinum", d).notes.some((n) => /not Platinum/.test(n)));
  assert.ok(interpret("a 1 ct oval in 6 prongs", d).notes.some((n) => /centre stone/.test(n)));

  const hollow = await compileDesign(parse(BASE.replace("fit=ring", "fit=ring hollow=0.6")).design, { loadAsset });
  assert.ok(report(hollow, hollow.exact).checks.some((c) => c.level === "warn" && /vent or drain hole/.test(c.text)));

  files["two.stl"] = stl(new THREE.TorusGeometry(10, 1.4, 32, 128), new THREE.SphereGeometry(4, 24, 16).translate(30, 0, 0));
  const debris = await compileDesign(parse(BASE.replace("ring.stl", "two.stl")).design, { loadAsset });
  assert.ok(report(debris, debris.exact).checks.some((c) => c.level === "warn" && /keep=all/.test(c.text)));
});
