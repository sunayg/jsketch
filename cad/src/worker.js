// Background worker: prepares sculpts and builds the exact solid (Manifold)
// so the editor stays responsive.
//   { kind: "sculpt", id, sculpt, innerDiameter } -> prepared mesh + info
//   { kind: "exact", id, text }                  -> exact volumes + metal mesh
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { initKernel, solidify } from "./kernel.js";
import { parse } from "./script.js";
import { build } from "./build.js";
import { resolveSculpts } from "./sculpts.js";
import { getAsset } from "./assets-idb.js";

const ready = initKernel({ locateFile: () => wasmUrl });
const loadAsset = (src) => getAsset(src);

const flatten = (mesh) => {
  const out = new Float32Array(mesh.triVerts.length * 3);
  for (let i = 0; i < mesh.triVerts.length; i++) {
    const v = mesh.triVerts[i] * mesh.numProp;
    out[i * 3] = mesh.vertProperties[v];
    out[i * 3 + 1] = mesh.vertProperties[v + 1];
    out[i * 3 + 2] = mesh.vertProperties[v + 2];
  }
  return out;
};

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    await ready;
    if (msg.kind === "sculpt") {
      const t0 = performance.now();
      const design = { ring: { diameter: msg.innerDiameter }, sculpts: [msg.sculpt] };
      const got = [...(await resolveSculpts(design, loadAsset)).values()][0];
      if (got.error) throw new Error(got.error);
      const positions = Float32Array.from(got.geometry.attributes.position.array);
      const thickness = Float32Array.from(got.geometry.userData.thickness);
      self.postMessage({ kind: "sculpt", id: msg.id, positions, thickness, info: { ...got.info, ms: performance.now() - t0 } }, [positions.buffer, thickness.buffer]);
      return;
    }
    const { design, errors } = parse(msg.text);
    if (errors.length) throw new Error("script has errors");
    const sculpts = await resolveSculpts(design, loadAsset);
    const model = build(design, { quality: msg.quality || "standard", sculpts });
    const t0 = performance.now();
    const exact = solidify(model);
    const positions = flatten(exact.solid.getMesh());
    const { volume, gross, pieces, slivers, invalid } = exact;
    exact.free();
    self.postMessage({ kind: "exact", id: msg.id, exact: { volume, gross, pieces, slivers, invalid, ms: performance.now() - t0 }, positions }, [positions.buffer]);
  } catch (err) {
    self.postMessage({ kind: msg.kind || "exact", id: msg.id, error: err.message });
  }
};
