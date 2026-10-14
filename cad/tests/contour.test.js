// Contour fitting: a sculpted ring's band traced slice by slice and rebuilt.
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { initKernel } from "../src/kernel.js";
import { prepareSculpt } from "../src/sculpt.js";
import { fitBand, rebuildRing, radialSections } from "../src/contour.js";

await initKernel();
const plain = (g) => {
  const x = g.toNonIndexed();
  x.deleteAttribute("uv");
  x.deleteAttribute("normal");
  return x;
};
const soupOf = (...geos) => Float32Array.from(mergeGeometries(geos.map(plain)).attributes.position.array);

test("a plain band is traced into smooth sections and rebuilt to within a hair", () => {
  // a D-section band: a flattened torus, wider than it is thick
  const band = new THREE.TorusGeometry(9.8, 1.2, 48, 160).scale(1, 1, 1.8);
  const { manifold } = prepareSculpt(soupOf(band), { fit: "ring" }, { innerDiameter: 17.32 });
  const secs = radialSections(manifold, 24);
  assert.equal(secs.length, 24);
  assert.ok(secs.every((s) => s.polys.length === 1), "one outline per slice");
  const fit = fitBand(manifold);
  assert.equal(fit.head, null, "no head on a plain band");
  assert.equal(fit.sections.length, 72);
  assert.ok(fit.maxError < 0.03, `trace error ${fit.maxError}`);
  const { solid } = rebuildRing(manifold, fit);
  assert.ok(Math.abs(solid.volume() / manifold.volume() - 1) < 0.01, `${solid.volume()} vs ${manifold.volume()}`);
});

test("the head is found, kept as it was, and the band is traced either side", () => {
  // a band with four prongs standing on top: slices through the head show
  // the prongs as separate islands
  const prongs = [[-1.6, -1.6], [1.6, -1.6], [1.6, 1.6], [-1.6, 1.6]].map(([x, z]) => new THREE.CylinderGeometry(0.45, 0.5, 4, 16).translate(x, 12.6, z));
  const ring = soupOf(new THREE.TorusGeometry(10, 1.4, 48, 160), ...prongs);
  const { manifold } = prepareSculpt(ring, { fit: "ring" }, { innerDiameter: 17.32 });
  const fit = fitBand(manifold);
  assert.ok(fit.head, "head found");
  const span = ((fit.head.to - fit.head.from + 1) * 360) / fit.count;
  assert.ok(span > 15 && span < 120, `head spans ${span}°`);
  const { solid, head } = rebuildRing(manifold, fit);
  assert.ok(head.volume() > 5);
  assert.ok(Math.abs(solid.volume() / manifold.volume() - 1) < 0.02, `${solid.volume()} vs ${manifold.volume()}`);
  assert.equal(solid.decompose().length, 1, "one piece");
});
