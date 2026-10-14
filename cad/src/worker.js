// Background worker: builds the exact solid (Manifold) so the editor stays
// responsive. Receives script text, returns exact volumes, pieces and the
// watertight metal mesh.
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { initKernel, solidify } from "./kernel.js";
import { parse } from "./script.js";
import { build } from "./build.js";

const ready = initKernel({ locateFile: () => wasmUrl });

self.onmessage = async (e) => {
  const { id, text, quality = "standard" } = e.data;
  try {
    await ready;
    const { design, errors } = parse(text);
    if (errors.length) throw new Error("script has errors");
    const model = build(design, { quality });
    const t0 = performance.now();
    const exact = solidify(model);
    const mesh = exact.solid.getMesh();
    const positions = new Float32Array(mesh.triVerts.length * 3);
    for (let i = 0; i < mesh.triVerts.length; i++) {
      const v = mesh.triVerts[i] * mesh.numProp;
      positions[i * 3] = mesh.vertProperties[v];
      positions[i * 3 + 1] = mesh.vertProperties[v + 1];
      positions[i * 3 + 2] = mesh.vertProperties[v + 2];
    }
    const { volume, gross, pieces, slivers, invalid } = exact;
    exact.free();
    self.postMessage({ id, exact: { volume, gross, pieces, slivers, invalid, ms: performance.now() - t0 }, positions }, [positions.buffer]);
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
