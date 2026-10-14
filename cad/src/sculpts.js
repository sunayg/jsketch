// Loads and prepares the sculpts a design uses, with a cache keyed by the
// sculpt's file and options, so a prepared mesh is reused across rebuilds.
import { sculptKey } from "./build.js";
import { readMesh } from "./meshio.js";
import { prepareSculpt } from "./sculpt.js";
import { toGeometry } from "./kernel.js";
import { parseSize } from "./sizes.js";
import { TriGrid, wallThickness } from "./surface.js";

const cache = new Map();

export const innerDiameterOf = (d) => d.ring.diameter ?? parseSize(d.ring.size).innerDiameter;

// loadAsset(src) -> { bytes: Uint8Array, ext } (async). Returns the Map that
// build() takes. Uses the solid kernel, so call initKernel() first.
export async function resolveSculpts(design, loadAsset) {
  const out = new Map();
  for (const sc of design.sculpts) {
    const key = sculptKey(sc) + `|${sc.fit === "ring" ? innerDiameterOf(design).toFixed(4) : ""}`;
    if (!cache.has(key)) {
      try {
        const asset = await loadAsset(sc.src);
        if (!asset) throw new Error(`file ${sc.src} not found`);
        const { manifold, info } = prepareSculpt(readMesh(asset.bytes, asset.ext), sc, { innerDiameter: innerDiameterOf(design) });
        cache.set(key, withWall(toGeometry(manifold), info));
        manifold.delete();
      } catch (e) {
        cache.set(key, { error: e.message });
      }
    }
    out.set(sculptKey(sc), cache.get(key));
  }
  return out;
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
