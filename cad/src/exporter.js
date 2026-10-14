// One export path for the editor (in its worker), the CLI and the MCP
// server: build the design with its sculpts, make the exact solid, then
// write the file. Needs the solid kernel (initKernel) to be ready.
import { build } from "./build.js";
import { solidify, toGeometry } from "./kernel.js";
import { resolveSculpts, innerDiameterOf } from "./sculpts.js";
import { report } from "./report.js";
import { stlBytes, to3mf, bundle, glbBytes, objText } from "./export.js";
import { formatSize, parseSize } from "./sizes.js";
import { zipStore } from "./zip.js";

export const FORMATS = ["stl", "stl-stones", "3mf", "glb", "obj", "bundle", "sizerun"];
export const QUALITIES = ["draft", "standard", "fine"];

// The built model with model.solidGeometry (one watertight shell, seats cut)
// and model.exact (volumes, pieces).
export async function compileDesign(design, { quality = "standard", loadAsset, baseInner }) {
  if (!QUALITIES.includes(quality)) throw new Error(`quality must be one of ${QUALITIES.join(", ")}`);
  const sculpts = await resolveSculpts(design, loadAsset, { baseInner });
  const model = build(design, { quality, sculpts });
  const exact = solidify(model);
  model.solidGeometry = toGeometry(exact.solid);
  model.exact = exact;
  exact.free();
  return model;
}

// The objects an export can be limited to: those that make metal or stones.
export const partNames = (model) => [...new Set([...model.metal, ...model.stones].map((x) => String(x.obj).split("~")[0]))];

// -> { bytes, ext }. opts: quality, part (stl/stl-stones only), sizes (an
// array like ["US5", "US5.5"] for sizerun), shrink (%), loadAsset, model
// (an already compiled model for this design and quality, to reuse).
export async function exportDesign(design, text, format, opts = {}) {
  const { quality = "standard", part, sizes, loadAsset } = opts;
  if (!FORMATS.includes(format)) throw new Error(`unknown format "${format}" (${FORMATS.join(", ")})`);
  const d = opts.shrink === undefined ? design : { ...design, rule: { ...design.rule, shrink: opts.shrink } };
  if (format === "sizerun") {
    if (!sizes?.length) throw new Error("a size run needs a list of sizes");
    const files = {};
    const baseInner = innerDiameterOf(d);
    const problems = [];
    for (const size of sizes) {
      const s = parseSize(size);
      if (!s) throw new Error(`Bad size ${size}`);
      const ds = structuredClone(d);
      ds.ring.size = formatSize(s.system, s.n);
      delete ds.ring.diameter;
      delete ds.exprs?.["ring.diameter"];
      // sculpts keep their head and section (see resize.js); every size is
      // checked like the design itself, and a size that fails stops the run
      const m = await compileDesign(ds, { quality, loadAsset, baseInner });
      const r = report(m, m.exact);
      const bad = r.checks.filter((c) => c.level === "error");
      if (bad.length) problems.push(`${ds.ring.size}: ${bad.map((c) => c.text).join("; ")}`);
      files[`${ds.name.replace(/[^\w-]+/g, "_")}_${ds.ring.size}.stl`] = stlBytes(m, "metal");
    }
    if (problems.length) throw new Error(`Not exported; ${problems.length} size(s) fail the checks: ${problems.join(" | ")}`);
    return { bytes: zipStore(files), ext: "zip" };
  }
  const model = opts.model ?? (await compileDesign(d, { quality, loadAsset }));
  if (model.errors?.length) throw new Error(model.errors[0]);
  if (part !== undefined && part !== "") {
    const names = partNames(model);
    if (!names.includes(part)) throw new Error(`no part named "${part}" (parts: ${names.join(", ")})`);
    if (!["stl", "stl-stones"].includes(format)) throw new Error("a single part can be exported as stl or stl-stones");
  }
  const one = part || undefined;
  if (format === "stl-stones" && !model.stones.some((s) => !one || String(s.obj).split("~")[0] === one)) throw new Error(one ? `${one} has no stones` : "This design has no stones");
  switch (format) {
    case "stl": return { bytes: stlBytes(model, "metal", { obj: one }), ext: "stl" };
    case "stl-stones": return { bytes: stlBytes(model, "stones", { obj: one }), ext: "stl" };
    case "3mf": return { bytes: to3mf(model), ext: "3mf" };
    case "glb": return { bytes: glbBytes(model), ext: "glb" };
    case "obj": return { bytes: objText(model), ext: "obj" };
    case "bundle": {
      // the sculpt meshes travel with the script, named so src= finds them
      const meshes = {};
      for (const sc of d.sculpts) {
        const a = await loadAsset(sc.src);
        if (a) meshes[/^[0-9a-f]{16}$/.test(sc.src) ? `${sc.src}.${a.ext}` : sc.src] = a.bytes;
      }
      return { bytes: bundle(d, model, text, meshes), ext: "zip" };
    }
  }
}
