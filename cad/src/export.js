// Bake a built model into export-ready geometry (mm), with casting shrinkage applied.
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { stoneGeometry } from "./gems.js";
import { stoneMatrix } from "./build.js";
import { zipStore } from "./zip.js";

const flat = (g) => {
  const out = g.index ? g.toNonIndexed() : g.clone();
  out.deleteAttribute("uv");
  return out;
};

export function bakeGeometry(model, which, shrinkPercent = model.design.rule.shrink || 0) {
  const geos = which === "stones"
    ? model.stones.map((s) => flat(stoneGeometry(s.cut, s.dia)).applyMatrix4(stoneMatrix(s)))
    : model.metal.map((m) => flat(m.geometry));
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
    const key = `${p.getX(i).toFixed(5)},${p.getY(i).toFixed(5)},${p.getZ(i).toFixed(5)}`;
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
