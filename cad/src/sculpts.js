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
// opts.baseInner: fit ring sculpts at this inside diameter and then open or
// close only the bore to the design's size (a size run: the head and the
// band's section stay as designed, as a jeweller sizes a ring).
export async function resolveSculpts(design, loadAsset, opts = {}) {
  const out = new Map();
  const inner = innerDiameterOf(design);
  for (const sc of design.sculpts) {
    const fitInner = sc.fit === "ring" && opts.baseInner ? opts.baseInner : inner;
    const key = sculptKey(sc) + `|${sc.fit === "ring" ? fitInner.toFixed(4) : ""}`;
    if (!cache.has(key)) {
      try {
        const asset = await loadAsset(sc.src);
        if (!asset) throw new Error(`file ${sc.src} not found`);
        const { manifold, info } = prepareSculpt(readMesh(asset.bytes, asset.ext), sc, { innerDiameter: fitInner });
        cache.set(key, withWall(toGeometry(manifold), info));
        manifold.delete();
      } catch (e) {
        cache.set(key, { error: e.message });
      }
    }
    let got = cache.get(key);
    if (got.geometry && Math.abs(fitInner - inner) > 1e-6) got = resized(got, (inner - fitInner) / 2, fitInner / 2);
    out.set(sculptKey(sc), got);
  }
  return out;
}

// Resize a fitted sculpt (head at +Y) the way a jeweller does: the top,
// where the head is, moves up rigidly by dr; the shank moves out from the
// finger axis by dr, keeping its section; the sides blend between the two.
// The bore changes by 2*dr and the head keeps its exact shape.
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// ri: the bore radius before resizing; metal near the bore always moves
// radially, so the finger hole stays round.
export const radialShift = (x, y, dr, ri = 0) => {
  const r = Math.hypot(x, y);
  if (r < 1e-9) return [x, y + dr];
  const phi = Math.abs(Math.atan2(x, y)) * (180 / Math.PI); // 0 at the top
  const w = (1 - smooth(35, 75, phi)) * smooth(ri + 0.8, ri + 2, r); // 1: rigid lift, 0: radial
  return [x + (1 - w) * (x / r) * dr, y + w * dr + (1 - w) * (y / r) * dr];
};
function resized(got, dr, ri) {
  const geometry = got.geometry.clone();
  const p = geometry.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) [p[i], p[i + 1]] = radialShift(p[i], p[i + 1], dr, ri);
  geometry.attributes.position.needsUpdate = true;
  geometry.userData.thickness = got.geometry.userData.thickness;
  const info = { ...got.info, resizedBy: +(2 * dr).toFixed(3) };
  if (info.bore) info.bore = +(info.bore + 2 * dr).toFixed(3);
  if (info.boreMin) info.boreMin = +(info.boreMin + 2 * dr).toFixed(3);
  return { geometry, info };
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
