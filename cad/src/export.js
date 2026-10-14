// Bake a built model into export-ready geometry (mm), with casting shrinkage applied.
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { stoneGeometry } from "./gems.js";
import { stoneMatrix } from "./build.js";
import { zipStore } from "./zip.js";
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { serialize } from "./script.js";
import { RANGE } from "./sizes.js";

const flat = (g) => {
  const out = g.index ? g.toNonIndexed() : g.clone();
  out.deleteAttribute("uv");
  return out;
};

// which: "metal" | "stones"; opts.obj limits the bake to one object (per-part export)
// When the model carries the kernel's solid (model.solidGeometry), whole-piece
// metal exports use it: one watertight shell with the stone seats cut.
export function bakeGeometry(model, which, shrinkPercent = model.design.rule.shrink || 0, opts = {}) {
  if (which === "metal" && !opts.obj && model.solidGeometry) {
    const g = model.solidGeometry.clone();
    const k = 1 + shrinkPercent / 100;
    if (k !== 1) g.scale(k, k, k);
    return g;
  }
  const keep = (x) => !opts.obj || x.obj === opts.obj || x.obj === `${opts.obj}~mirror` || (x.obj || "").startsWith(`${opts.obj}~`);
  const geos = which === "stones"
    ? model.stones.filter(keep).map((s) => flat(stoneGeometry(s.cut, s.dia)).applyMatrix4(stoneMatrix(s)))
    : model.metal.filter(keep).map((m) => flat(m.geometry));
  if (!geos.length) return null;
  const merged = mergeGeometries(geos);
  const k = 1 + shrinkPercent / 100;
  if (k !== 1) merged.scale(k, k, k);
  return merged;
}

// Weld vertices so the 3MF mesh is indexed.
function toMesh(geo) {
  const p = geo.attributes.position;
  const map = new Map();
  const verts = [];
  const tris = [];
  const idx = [];
  for (let i = 0; i < p.count; i++) {
    // weld at 1 µm so seam vertices that differ by float noise become one
    const q = (v) => Math.round(v * 1e3) || 0;
    const key = `${q(p.getX(i))},${q(p.getY(i))},${q(p.getZ(i))}`;
    let v = map.get(key);
    if (v === undefined) {
      v = verts.length / 3;
      map.set(key, v);
      verts.push(p.getX(i), p.getY(i), p.getZ(i));
    }
    idx.push(v);
  }
  for (let i = 0; i < idx.length; i += 3) {
    if (idx[i] !== idx[i + 1] && idx[i + 1] !== idx[i + 2] && idx[i] !== idx[i + 2]) tris.push(idx[i], idx[i + 1], idx[i + 2]);
  }
  return { verts, tris };
}

const meshXml = ({ verts, tris }, id, name) => {
  let v = "";
  for (let i = 0; i < verts.length; i += 3) v += `<vertex x="${+verts[i].toFixed(5)}" y="${+verts[i + 1].toFixed(5)}" z="${+verts[i + 2].toFixed(5)}"/>`;
  let t = "";
  for (let i = 0; i < tris.length; i += 3) t += `<triangle v1="${tris[i]}" v2="${tris[i + 1]}" v3="${tris[i + 2]}"/>`;
  return `<object id="${id}" name="${name}" type="model"><mesh><vertices>${v}</vertices><triangles>${t}</triangles></mesh></object>`;
};

// 3MF package: units in millimetres, metal and stones as separate objects.
export function to3mf(model, shrinkPercent) {
  const parts = [];
  const metal = bakeGeometry(model, "metal", shrinkPercent);
  if (metal) parts.push(meshXml(toMesh(metal), parts.length + 1, "metal"));
  const stones = bakeGeometry(model, "stones", shrinkPercent);
  if (stones) parts.push(meshXml(toMesh(stones), parts.length + 1, "stones"));
  const items = parts.map((_, i) => `<item objectid="${i + 1}"/>`).join("");
  const modelXml = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${parts.join("")}</resources><build>${items}</build></model>`;
  return zipStore({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`,
    "3D/3dmodel.model": modelXml,
  });
}

// Binary STL of metal or stones (optionally one object), in mm.
export function stlBytes(model, which, opts = {}) {
  const g = bakeGeometry(model, which, undefined, opts);
  if (!g) return new Uint8Array(84); // a valid STL with no triangles
  const view = new STLExporter().parse(new THREE.Mesh(g || new THREE.BufferGeometry()), { binary: true });
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

// Sizes from..to in a system, only those the language accepts. Throws on a
// reversed or empty range, or more than `max` sizes.
export function sizeRange(system, from, to, step = 0.5, max = 40) {
  if (!(step > 0)) throw new Error("size step must be above 0");
  if (to < from) throw new Error(`size range ends (${to}) before it starts (${from})`);
  const [lo, hi] = RANGE[system] || [];
  if (lo === undefined) throw new Error(`unknown size system ${system}`);
  if (from < lo - 1e-9 || to > hi + 1e-9) throw new Error(`${system} sizes run from ${lo} to ${hi}; ${from}-${to} goes outside that`);
  const out = [];
  for (let n = from; n <= to + 1e-9; n += step) out.push(`${system}${+n.toFixed(2)}`);
  if (out.length > max) throw new Error(`${out.length} sizes is more than ${max} per run`);
  return out;
}

// Portable bundle: the source script plus meshes, so it opens anywhere.
// `text` is the script as written (comments and all); falls back to canonical.
// extra: more files to include (the sculpt meshes the script uses).
export function bundle(design, model, text = null, extra = {}) {
  return zipStore({
    ...extra,
    "design.jws": text ?? serialize(design),
    "metal.stl": stlBytes(model, "metal"),
    ...(model.stones.length ? { "stones.stl": stlBytes(model, "stones") } : {}),
    "model.3mf": to3mf(model),
    "README.txt": "JewelScript bundle: design.jws is the editable source; the meshes are in millimetres. Sculpt meshes the script uses are included under the names its src= refers to; keep them next to design.jws.\n",
  });
}

// ---- GLB and OBJ without a browser (CLI, MCP) ----
const meshParts = (model) => [["metal", bakeGeometry(model, "metal"), [0.85, 0.75, 0.45, 1], 1], ["stones", bakeGeometry(model, "stones"), [0.92, 0.96, 1, 1], 0]].filter(([, g]) => g);

// Binary glTF: one node per part, positions and normals, scaled mm -> m.
export function glbBytes(model) {
  const parts = meshParts(model);
  const chunks = [];
  let offset = 0;
  const json = { asset: { version: "2.0", generator: "JewelScript CAD" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "piece", matrix: [0.001, 0, 0, 0, 0, 0.001, 0, 0, 0, 0, 0.001, 0, 0, 0, 0, 1], children: [] }], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
  for (const [name, g, color, metallic] of parts) {
    const geo = g.index ? g.toNonIndexed() : g;
    geo.computeVertexNormals();
    const pos = Float32Array.from(geo.attributes.position.array);
    const nrm = Float32Array.from(geo.attributes.normal.array);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], pos[i + k]);
      max[k] = Math.max(max[k], pos[i + k]);
    }
    const view = (arr) => {
      json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: arr.byteLength, target: 34962 });
      chunks.push(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
      offset += arr.byteLength;
      return json.bufferViews.length - 1;
    };
    json.accessors.push({ bufferView: view(pos), componentType: 5126, count: pos.length / 3, type: "VEC3", min, max });
    json.accessors.push({ bufferView: view(nrm), componentType: 5126, count: nrm.length / 3, type: "VEC3" });
    json.materials.push({ name, pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: metallic, roughnessFactor: metallic ? 0.25 : 0.05 } });
    json.meshes.push({ name, primitives: [{ attributes: { POSITION: json.accessors.length - 2, NORMAL: json.accessors.length - 1 }, material: json.materials.length - 1 }] });
    json.nodes.push({ name, mesh: json.meshes.length - 1 });
    json.nodes[0].children.push(json.nodes.length - 1);
  }
  json.buffers.push({ byteLength: offset });
  let jsonText = JSON.stringify(json);
  while (jsonText.length % 4) jsonText += " ";
  const jb = new TextEncoder().encode(jsonText);
  const binLen = Math.ceil(offset / 4) * 4;
  const out = new Uint8Array(12 + 8 + jb.length + 8 + binLen);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, jb.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jb, 20);
  dv.setUint32(20 + jb.length, binLen, true);
  dv.setUint32(24 + jb.length, 0x004e4942, true);
  let o = 28 + jb.length;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

// OBJ text with named objects (mm).
export function objText(model) {
  const lines = ["# JewelScript CAD, units: mm"];
  let base = 1;
  for (const [name, g] of meshParts(model)) {
    const geo = g.index ? g.toNonIndexed() : g;
    const p = geo.attributes.position.array;
    lines.push(`o ${name}`);
    for (let i = 0; i < p.length; i += 3) lines.push(`v ${+p[i].toFixed(5)} ${+p[i + 1].toFixed(5)} ${+p[i + 2].toFixed(5)}`);
    for (let i = 0; i < p.length / 3; i += 3) lines.push(`f ${base + i} ${base + i + 1} ${base + i + 2}`);
    base += p.length / 3;
  }
  return new TextEncoder().encode(lines.join("\n") + "\n");
}
