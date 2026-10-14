// Operations shared by the CLI and the MCP server. Each takes script text.
import { parse, serialize, SCHEMA, METALS, PROFILES, SETTINGS, TIPS, HALO_KINDS } from "../src/script.js";
import { build } from "../src/build.js";
import { report } from "../src/report.js";
import { CUTS, MELEE_SIZES } from "../src/gems.js";
import { DESIGNS, COMPONENTS, search } from "../src/library.js";
import { interpret } from "../src/assistant.js";
import { sizeRange } from "../src/export.js";
import { compileDesign, exportDesign, QUALITIES } from "../src/exporter.js";
import { mergeText } from "../src/script.js";
import { renderPng } from "./render.js";
import { initKernel } from "../src/kernel.js";
import { readMesh, assetId } from "../src/meshio.js";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { resolve, join, extname, isAbsolute } from "node:path";

// Mesh files for sculpts: by asset id in the assets folder, or by file name
// relative to the assets folder (CLI: the script's folder is searched first).
export const ASSETS = resolve(process.env.JEWELSCRIPT_ASSETS || "jewelscript-assets");
export async function loadAsset(src, baseDir) {
  if (/^[0-9a-f]{16}$/.test(src)) {
    // the assets folder, or next to the script (an unpacked bundle)
    for (const dir of [ASSETS, baseDir].filter(Boolean)) {
      const files = await readdir(dir).catch(() => []);
      const f = files.find((n) => n.startsWith(src + ".") && ["stl", "obj", "glb"].includes(extname(n).slice(1).toLowerCase()));
      if (f) return { bytes: new Uint8Array(await readFile(join(dir, f))), ext: extname(f).slice(1) };
    }
    return null;
  }
  // a file name, or a path inside the script's folder or the assets folder;
  // never somewhere else on the disk
  if (typeof src !== "string" || isAbsolute(src) || src.split(/[\\/]/).includes("..")) return null;
  for (const dir of [baseDir, ASSETS].filter(Boolean)) {
    const path = join(dir, src);
    try {
      return { bytes: new Uint8Array(await readFile(path)), ext: extname(path).slice(1) };
    } catch {}
  }
  return null;
}

// Copy a mesh into the assets folder; returns its id and a ready sculpt line.
export async function importMesh(path) {
  if (typeof path !== "string" || !path.trim()) throw new Error("path must be the path of a mesh file (a string)");
  const ext = extname(path).slice(1).toLowerCase();
  if (!["stl", "obj", "glb"].includes(ext)) throw new Error("import_mesh takes .stl, .obj or .glb files");
  const bytes = await readFile(path).then((b) => new Uint8Array(b), (e) => {
    throw new Error(e.code === "ENOENT" ? `no file at ${path}` : `cannot read ${path}: ${e.code || e.message}`);
  });
  const soup = readMesh(bytes, ext);
  if (soup.length / 9 < 20) throw new Error(`${path} has only ${soup.length / 9} triangle(s); a sculpt needs a real mesh`); // fails early on unreadable files
  const id = await assetId(bytes);
  await mkdir(ASSETS, { recursive: true });
  await writeFile(join(ASSETS, `${id}.${ext}`), bytes);
  return { id, triangles: soup.length / 9, line: `sculpt id=sculpt1 src=${id} fit=ring repair=auto` };
}

// The files in a zip (stored or deflated entries).
export function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) {
    end = i;
    break;
  }
  if (end < 0) throw new Error("not a zip file");
  const count = dv.getUint16(end + 10, true);
  let p = dv.getUint32(end + 16, true);
  const out = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("damaged zip directory");
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    if (method === 0) out[name] = raw;
    else if (method === 8) out[name] = new Uint8Array(inflateRawSync(raw));
    else throw new Error(`${name}: unsupported zip compression`);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// Open a bundle: its meshes go into the assets folder; returns the script.
export async function openBundle(path) {
  if (typeof path !== "string" || !path.trim()) throw new Error("path must be the path of a bundle .zip (a string)");
  const bytes = await readFile(path).then((b) => new Uint8Array(b), (e) => {
    throw new Error(e.code === "ENOENT" ? `no file at ${path}` : `cannot read ${path}: ${e.code || e.message}`);
  });
  const files = readZip(bytes);
  if (!files["design.jws"]) throw new Error("this zip has no design.jws; is it a JewelScript bundle?");
  const design = new TextDecoder().decode(files["design.jws"]);
  const { design: d } = parse(design);
  const copied = [];
  await mkdir(ASSETS, { recursive: true });
  for (const sc of d.sculpts) {
    const name = Object.keys(files).find((n) => n === sc.src || n.startsWith(`${sc.src}.`));
    if (!name || name.includes("/") || name.includes("\\") || name.startsWith(".")) continue;
    await writeFile(join(ASSETS, name), files[name]);
    copied.push(name);
  }
  const missing = d.sculpts.filter((sc) => !copied.some((n) => n === sc.src || n.startsWith(`${sc.src}.`))).map((sc) => sc.src);
  return { design, meshesCopied: copied, ...(missing.length ? { missing } : {}) };
}

// Round floats so JSON stays readable (20.9196 rather than 20.919600000000003).
export const tidy = (v) =>
  typeof v === "number" ? Math.round(v * 1e4) / 1e4 : Array.isArray(v) ? v.map(tidy) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tidy(x)])) : v;

export function validate(text) {
  const { errors } = parse(text);
  return { ok: errors.length === 0, errors };
}

// The solid kernel (Manifold) gives exact volumes and watertight exports.
export const ready = initKernel();

let baseDir = null;
export const setBaseDir = (dir) => (baseDir = dir);

function parseText(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("design must be the JewelScript text of a design (a non-empty string)");
  const { design, errors } = parse(text);
  if (errors.length) {
    const e = new Error("The script has errors");
    e.errors = errors;
    throw e;
  }
  return design;
}
const assets = (src) => loadAsset(src, baseDir);
async function compile(text, quality = "standard") {
  await ready;
  if (!QUALITIES.includes(quality)) throw new Error(`quality must be one of ${QUALITIES.join(", ")}`);
  const design = parseText(text);
  return { design, model: await compileDesign(design, { quality, loadAsset: assets }) };
}

export async function measure(text) {
  const { model } = await compile(text);
  return tidy(report(model, model.exact));
}

export async function stoneFit(text) {
  const r = await measure(text);
  const relevant = r.checks.filter((c) => /overlap|prong|bore|overhang|holding|culet|edge|touch|fit/.test(c.text));
  return { ok: !relevant.some((c) => c.level === "error"), stoneCount: r.stoneCount, findings: relevant.length ? relevant : [{ level: "ok", text: "All stones clear the metal and each other" }] };
}

export const VIEWS = ["iso", "top", "front", "side"];
export async function render(text, { views = ["iso", "top"], size = 512 } = {}) {
  const bad = views.filter((v) => !VIEWS.includes(v));
  if (bad.length) throw new Error(`unknown view ${bad.join(", ")} (views: ${VIEWS.join(", ")})`);
  if (!Number.isFinite(+size) || size < 64 || size > 1024) throw new Error("size must be a number of pixels from 64 to 1024");
  const { model } = await compile(text, "draft");
  return views.map((view) => ({ view, png: renderPng(model, { view, size }) }));
}

// Two designs build the same piece when weights, sizes and stones agree.
export async function compare(a, b) {
  const [ra, rb] = [await measure(a), await measure(b)];
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

export async function edit(text, request) {
  const { design } = await compile(text);
  if (typeof request !== "string" || !request.trim()) throw new Error("request must describe the change in words");
  const r = interpret(request, design);
  // keep the caller's comments and layout; only changed lines are rewritten
  return { text: mergeText(text, r.design), changes: r.changes, notes: r.notes, notUnderstood: r.ignored };
}

export async function exportBytes(text, format, { quality = "standard", part, sizes } = {}) {
  await ready;
  const design = parseText(text);
  let list;
  if (format === "sizerun") {
    const m = /^(US|EU|DE|IT|JP)(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)(?::(\d+(?:\.\d+)?))?$/i.exec(sizes || "");
    if (!m) throw new Error('sizes must look like "US5-8:0.5"');
    list = sizeRange(m[1].toUpperCase(), +m[2], +m[3], m[4] ? +m[4] : 0.5);
  }
  return exportDesign(design, text, format, { quality, part, sizes: list, loadAsset: assets });
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
