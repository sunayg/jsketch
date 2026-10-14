// Operations shared by the CLI and the MCP server. Each takes script text.
import { parse, serialize, SCHEMA, METALS, PROFILES, SETTINGS, TIPS, HALO_KINDS } from "../src/script.js";
import { build } from "../src/build.js";
import { report } from "../src/report.js";
import { CUTS, MELEE_SIZES } from "../src/gems.js";
import { DESIGNS, COMPONENTS, search } from "../src/library.js";
import { interpret } from "../src/assistant.js";
import { stlBytes, to3mf, bundle, sizeRun, sizeRange } from "../src/export.js";
import { renderPng } from "./render.js";

// Round floats so JSON stays readable (20.9196 rather than 20.919600000000003).
export const tidy = (v) =>
  typeof v === "number" ? Math.round(v * 1e4) / 1e4 : Array.isArray(v) ? v.map(tidy) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tidy(x)])) : v;

export function validate(text) {
  const { errors } = parse(text);
  return { ok: errors.length === 0, errors };
}

function compile(text, quality) {
  const { design, errors } = parse(text);
  if (errors.length) {
    const e = new Error("The script has errors");
    e.errors = errors;
    throw e;
  }
  return { design, model: build(design, { quality }) };
}

export function measure(text) {
  const { model } = compile(text);
  return tidy(report(model));
}

export function stoneFit(text) {
  const r = measure(text);
  const relevant = r.checks.filter((c) => /overlap|prong|bore|overhang|holding|culet|edge|touch|fit/.test(c.text));
  return { ok: !relevant.some((c) => c.level === "error"), stoneCount: r.stoneCount, findings: relevant.length ? relevant : [{ level: "ok", text: "All stones clear the metal and each other" }] };
}

export function render(text, { views = ["iso", "top"], size = 512 } = {}) {
  const { model } = compile(text, "draft");
  return views.map((view) => ({ view, png: renderPng(model, { view, size }) }));
}

// Two designs build the same piece when weights, sizes and stones agree.
export function compare(a, b) {
  const ra = measure(a), rb = measure(b);
  const same = (x, y, tol) => Math.abs(x - y) <= tol * Math.max(1, Math.abs(x));
  const diffs = [];
  if (!same(ra.metal.volumeMm3, rb.metal.volumeMm3, 0.001)) diffs.push(`metal volume ${ra.metal.volumeMm3} vs ${rb.metal.volumeMm3} mm³`);
  if (ra.metal.name !== rb.metal.name) diffs.push(`metal ${ra.metal.name} vs ${rb.metal.name}`);
  if (!same(ra.innerDiameter, rb.innerDiameter, 0.0001)) diffs.push(`inside diameter ${ra.innerDiameter} vs ${rb.innerDiameter} mm`);
  const key = (r) => JSON.stringify(r.stones.map((s) => [s.role, s.cut, s.dia, s.count]).sort());
  if (key(ra) !== key(rb)) diffs.push("stone lists differ");
  const la = serialize(parse(a).design).split("\n"), lb = serialize(parse(b).design).split("\n");
  const lineDiff = [...la.filter((l) => !lb.includes(l)).map((l) => `- ${l}`), ...lb.filter((l) => !la.includes(l)).map((l) => `+ ${l}`)];
  return { same: diffs.length === 0, differences: diffs, scriptDiff: lineDiff };
}

export function edit(text, request) {
  const { design } = compile(text);
  const r = interpret(request, design);
  return { text: serialize(r.design), changes: r.changes, notUnderstood: r.ignored };
}

export function exportBytes(text, format, { quality = "standard", part, sizes } = {}) {
  const { design, model } = compile(text, quality);
  switch (format) {
    case "stl": return { bytes: stlBytes(model, "metal", { obj: part }), ext: "stl" };
    case "stl-stones": return { bytes: stlBytes(model, "stones", { obj: part }), ext: "stl" };
    case "3mf": return { bytes: to3mf(model), ext: "3mf" };
    case "bundle": return { bytes: bundle(design, model), ext: "zip" };
    case "sizerun": {
      const m = /^(US|EU|DE|IT|JP)(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)(?::(\d+(?:\.\d+)?))?$/i.exec(sizes || "");
      if (!m) throw new Error('sizes must look like "US5-8:0.5"');
      const list = sizeRange(m[1].toUpperCase(), +m[2], +m[3], m[4] ? +m[4] : 0.5);
      if (list.length > 40) throw new Error("at most 40 sizes per run");
      return { bytes: sizeRun(design, list, quality), ext: "zip" };
    }
    default: throw new Error(`unknown format "${format}" (stl, stl-stones, 3mf, bundle, sizerun)`);
  }
}

export function catalog() {
  return {
    commands: Object.fromEntries(Object.entries(SCHEMA).filter(([k]) => !["design", "var"].includes(k)).map(([cmd, keys]) => [cmd, Object.fromEntries(Object.entries(keys).map(([k, r]) => [k, Array.isArray(r[0]) ? { oneOf: r[0] } : r.length === 3 ? { type: r[0], min: r[1], max: r[2] } : { type: r[0] }]))])),
    cuts: Object.fromEntries(Object.entries(CUTS).map(([k, c]) => [k, { lengthToWidth: c.aspect }])),
    metals: Object.fromEntries(Object.entries(METALS).map(([k, m]) => [k, { label: m.label, density: m.density }])),
    profiles: PROFILES, settings: SETTINGS, tips: TIPS, haloKinds: HALO_KINDS,
    sizeSystems: ["US", "EU", "DE", "IT", "JP"], stockedMelee: MELEE_SIZES,
  };
}

export const examples = (query = "", kind = "all") => search(query, kind).map(({ name, kind: k, keywords }) => ({ name, kind: k, keywords }));
export function example(name) {
  const it = [...DESIGNS.map((d) => ({ ...d, kind: "design" })), ...COMPONENTS.map((c) => ({ ...c, kind: "component" }))].find((x) => x.name.toLowerCase() === String(name).toLowerCase());
  if (!it) throw new Error(`No example named "${name}"`);
  return { name: it.name, kind: it.kind, text: it.text };
}
