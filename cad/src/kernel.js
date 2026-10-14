// Solid-modelling kernel (Manifold, WASM). Turns metal parts into one
// watertight solid, cuts stone seats, and reports exact volume and pieces.
// Call initKernel() once (await) before using the other functions.
import * as THREE from "three";

let wasm = null;
export async function initKernel(options) {
  if (wasm) return wasm;
  const Module = (await import("manifold-3d")).default;
  wasm = await Module(options);
  wasm.setup();
  return wasm;
}
export const kernelReady = () => wasm !== null;
export const kernelModule = () => M();
const M = () => {
  if (!wasm) throw new Error("Kernel not initialised: await initKernel() first");
  return wasm;
};

// BufferGeometry (indexed or not) -> Manifold. Manifold's own merge() welds
// coincident vertices, which is much faster than welding in JavaScript.
export function toManifold(geometry) {
  const { Manifold, Mesh } = M();
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.attributes.position.array;
  const n = pos.length / 3;
  const tri = new Uint32Array(n);
  for (let i = 0; i < n; i++) tri[i] = i;
  const mesh = new Mesh({ numProp: 3, vertProperties: Float32Array.from(pos), triVerts: tri });
  mesh.merge();
  return new Manifold(mesh);
}

export function toGeometry(manifold) {
  const mesh = manifold.getMesh();
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(mesh.triVerts.length * 3);
  // flat triangles keep sharp edges crisp (seats, prongs)
  for (let i = 0; i < mesh.triVerts.length; i++) {
    const v = mesh.triVerts[i] * mesh.numProp;
    pos[i * 3] = mesh.vertProperties[v];
    pos[i * 3 + 1] = mesh.vertProperties[v + 1];
    pos[i * 3 + 2] = mesh.vertProperties[v + 2];
  }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export const statusOk = (m) => m.status() === "NoError" || m.status()?.value === 0;

// ---- solid metal ----
import { outline } from "./gems.js";
import { stoneMatrix } from "./build.js";

const FLUSH = new Set(["pave", "region", "stroke", "surface"]);
// cut-plane mapping: cross-section (X, Y) -> (x, z), extrusion Z -> down (-y)
const DOWN = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];

// Seat cutter in the stone's frame (girdle at y = 0, table up): the pavilion
// cone and a girdle band, plus an opening up to the surface for flush stones.
function seatCutter(cut, dia, flush, track) {
  const { CrossSection, Manifold } = M();
  const cs = track(new CrossSection([outline(cut, dia, 0.03, dia < 2.5 ? 16 : 32)])); // melee: 16 sides is plenty
  const pav = 0.43 * dia;
  const parts = [
    track(cs.extrude(pav + 0.08, 0, 0, [0.04, 0.04])), // pavilion, girdle to culet
    track(track(cs.extrude(0.12)).translate([0, 0, -0.06])), // girdle band (bearing)
  ];
  if (flush) parts.push(track(track(cs.extrude(0.9)).translate([0, 0, -0.9]))); // opening to the surface
  return track(track(Manifold.union(parts)).transform(DOWN));
}

// Union of all metal minus stone seats. Returns { solid, volume, gross,
// pieces, invalid } and owns `solid` (call free() on the result when done).
export function solidify(model, { seats = true } = {}) {
  const { Manifold } = M();
  const made = [];
  const track = (m) => (made.push(m), m);
  try {
    const invalid = [];
    const parts = [];
    for (const p of model.metal) {
      let m = null;
      try {
        m = track(p.manifold ? p.manifold.translate([0, 0, 0]) : toManifold(p.geometry)); // sculpts arrive as solids
      } catch {
        invalid.push(p.name); // not a closed solid
        continue;
      }
      if (statusOk(m) && !m.isEmpty()) parts.push(m);
      else invalid.push(p.name);
    }
    const union = track(Manifold.union(parts));
    const gross = union.volume();
    let solid = union;
    if (seats && model.stones.length) {
      const cache = new Map();
      const cutters = model.stones.map((s) => {
        const flush = FLUSH.has(s.role) || (s.role === "accent" && s.flush);
        const key = `${s.cut}|${s.dia}|${flush}`;
        if (!cache.has(key)) cache.set(key, seatCutter(s.cut, s.dia, flush, track));
        return track(cache.get(key).transform(stoneMatrix(s).elements));
      });
      solid = track(Manifold.difference([union, ...cutters]));
    }
    // Booleans can leave dust-sized fragments where cuts graze thin parts;
    // drop them, and keep any real separate piece so it can be reported.
    const SLIVER = 0.05; // mm³
    const all = solid.decompose().map((m) => track(m));
    const kept = all.filter((m) => m.volume() >= SLIVER);
    const slivers = all.length - kept.length;
    if (slivers) solid = track(Manifold.compose(kept));
    const pieces = kept.map((piece) => {
      const box = piece.boundingBox();
      return { volume: piece.volume(), min: box.min, max: box.max, center: box.min.map((v, i) => (v + box.max[i]) / 2) };
    }).sort((a, b) => b.volume - a.volume);
    // name the parts whose centre lies inside each extra piece's box
    for (const piece of pieces.slice(1)) {
      piece.parts = model.metal.filter((p) => {
        p.geometry.computeBoundingBox();
        const c = p.geometry.boundingBox.getCenter(new THREE.Vector3()).toArray();
        return c.every((v, i) => v >= piece.min[i] - 1e-6 && v <= piece.max[i] + 1e-6);
      }).map((p) => p.name);
    }
    made.splice(made.indexOf(solid), 1); // the caller owns the result
    return { solid, volume: solid.volume(), gross, pieces, slivers, invalid, free: () => solid.delete() };
  } finally {
    for (const m of made) m.delete();
  }
}
