// Loads and prepares the sculpts a design uses, with a cache keyed by the
// sculpt's file and options, so a prepared mesh is reused across rebuilds.
import { sculptKey } from "./build.js";
import { readMesh } from "./meshio.js";
import { prepareSculpt } from "./sculpt.js";
import { toGeometry } from "./kernel.js";
import { parseSize } from "./sizes.js";
import { TriGrid, wallThickness } from "./surface.js";
import { radialShift } from "./resize.js";
export { radialShift, radialUnshift, shiftFrame } from "./resize.js";

const cache = new Map();

export const innerDiameterOf = (d) => d.ring.diameter ?? parseSize(d.ring.size).innerDiameter;

// The inside diameter a sculpt was made for: its at= size (set when it is
// imported), else `fallback` (a size run's starting size), else the
// design's own size. At any other size the sculpt is resized the way a
// jeweller sizes a ring (see radialShift).
export const sculptBaseInner = (design, sc, fallback) => (sc.at ? parseSize(sc.at).innerDiameter : fallback ?? innerDiameterOf(design));

// loadAsset(src) -> { bytes: Uint8Array, ext } (async). Returns the Map that
// build() takes. Uses the solid kernel, so call initKernel() first.
// Each entry: { geometry, info } at the design's size, plus `base` (the
// prepared sculpt at its own size) and the shift { dr, ri } between them.
// opts.baseInner: the fallback base size for sculpts without at=.
export async function resolveSculpts(design, loadAsset, opts = {}) {
  const out = new Map();
  const inner = innerDiameterOf(design);
  for (const sc of design.sculpts) {
    const base = sculptBaseInner(design, sc, opts.baseInner);
    const key = sculptKey(sc) + `|${sc.fit === "ring" ? base.toFixed(4) : ""}`;
    if (!cache.has(key)) {
      try {
        const asset = await loadAsset(sc.src);
        if (!asset) throw new Error(`file ${sc.src} not found`);
        const { manifold, info } = prepareSculpt(readMesh(asset.bytes, asset.ext), sc, { innerDiameter: base });
        cache.set(key, withWall(toGeometry(manifold), info));
        manifold.delete();
      } catch (e) {
        cache.set(key, { error: e.message });
      }
    }
    let got = cache.get(key);
    const dr = (inner - base) / 2;
    if (got.geometry && Math.abs(dr) > 1e-6) {
      const rkey = `${key}|at ${inner.toFixed(4)}`;
      if (!cache.has(rkey)) cache.set(rkey, resized(got, dr, base / 2));
      got = cache.get(rkey);
    } else if (got.geometry) got = { ...got, base: got, shift: null };
    out.set(sculptKey(sc), got);
  }
  return out;
}

function resized(got, dr, ri) {
  const geometry = got.geometry.clone();
  const p = geometry.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) [p[i], p[i + 1]] = radialShift(p[i], p[i + 1], dr, ri);
  geometry.attributes.position.needsUpdate = true;
  const info = { ...got.info, resizedBy: +(2 * dr).toFixed(3) };
  if (info.bore) info.bore = +(info.bore + 2 * dr).toFixed(3);
  if (info.boreMin) info.boreMin = +(info.boreMin + 2 * dr).toFixed(3);
  // walls change where the sides are stretched: measure them again
  return { ...withWall(geometry, info), base: got, shift: { dr, ri } };
}

// Attach per-vertex wall thickness (for the heatmap) and the thinnest spot.
export function withWall(geometry, info) {
  const grid = new TriGrid(geometry);
  const wall = wallThickness(geometry, grid);
  geometry.userData.thickness = wall.perVertex;
  info.minWall = wall.min;
  return { geometry, info, grid };
}

// Prepared result for one sculpt, from mesh bytes (used by the browser worker).
export function prepareFromBytes(bytes, ext, sc, innerDiameter) {
  const { manifold, info } = prepareSculpt(readMesh(bytes, ext), sc, { innerDiameter });
  const g = toGeometry(manifold);
  manifold.delete();
  return { positions: g.attributes.position.array, info };
}
