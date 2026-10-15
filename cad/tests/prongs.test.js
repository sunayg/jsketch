// Prong tracing: prongs found in a sculpted ring's head and rebuilt from
// their own measurements.
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { initKernel } from "../src/kernel.js";
import { prepareSculpt } from "../src/sculpt.js";
import { headSlices, traceProngs, rebuildProngs, prongSolid } from "../src/prongs.js";

await initKernel();
const plain = (g) => {
  const x = g.toNonIndexed();
  x.deleteAttribute("uv");
  x.deleteAttribute("normal");
  return x;
};

test("four leaning, tapered prongs are found, measured and rebuilt", () => {
  // prongs 0.5 mm radius at the foot, 0.35 at the top, leaning out 8.6°,
  // around a ball "stone" that touches none of them
  const prongs = [[-1.6, -1.6], [1.6, -1.6], [1.6, 1.6], [-1.6, 1.6]].map(([x, z]) => new THREE.CylinderGeometry(0.35, 0.5, 4, 16).rotateZ(x > 0 ? -0.15 : 0.15).translate(x, 12.6, z));
  const soup = Float32Array.from(mergeGeometries([new THREE.TorusGeometry(10, 1.4, 48, 160), ...prongs, new THREE.SphereGeometry(1.9, 24, 16).translate(0, 13.2, 0)].map(plain)).attributes.position.array);
  const { manifold } = prepareSculpt(soup, { fit: "ring" }, { innerDiameter: 17.32 });
  const found = traceProngs(headSlices(manifold, { from: 11.5 }));
  assert.equal(found.length, 4);
  for (const p of found) {
    assert.ok(Math.abs(p.lean - 8.6) < 2, `lean ${p.lean}`);
    assert.ok(p.radius > 0.35 && p.radius < 0.5, `radius ${p.radius}`);
    assert.ok(p.section[0].a > p.section.at(-1).a, "tapers towards the top");
  }
  for (const tip of ["flat", "round", "pointed"]) assert.ok(prongSolid({ ...found[0], tip }).volume() > 0.5, tip);
  const { prongs: again, head } = rebuildProngs(manifold, { bandTop: 11.5 });
  assert.equal(again.length, 4);
  assert.ok(Math.abs(head.volume() / manifold.volume() - 1) < 0.02, `${head.volume()} vs ${manifold.volume()}`);
  assert.equal(head.decompose().length, 1, "one piece");
});
