// Mesh readers that work in Node and the browser (no DOM). Each returns a
// triangle soup: Float32Array of x,y,z per vertex, 9 numbers per triangle.

export function readMesh(bytes, ext) {
  const e = ext.toLowerCase().replace(/^\./, "");
  if (e === "stl") return readStl(bytes);
  if (e === "obj") return readObj(new TextDecoder().decode(bytes));
  if (e === "glb") return readGlb(bytes);
  throw new Error(`Cannot read .${e} meshes (use STL, OBJ or GLB)`);
}

export function readStl(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength >= 84) {
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === bytes.byteLength) {
      const out = new Float32Array(n * 9);
      for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) out[t * 9 + k] = dv.getFloat32(84 + t * 50 + 12 + k * 4, true);
      return out;
    }
  }
  const text = new TextDecoder().decode(bytes);
  const v = [...text.matchAll(/vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g)].flatMap((m) => [+m[1], +m[2], +m[3]]);
  if (!v.length || v.length % 9) throw new Error("Not a readable STL file");
  return Float32Array.from(v);
}

export function readObj(text) {
  const verts = [];
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const t = lines[n].trim().split(/\s+/);
    if (t[0] === "v") {
      const v = [+t[1], +t[2], +t[3]];
      if (!v.every(Number.isFinite)) throw new Error(`OBJ line ${n + 1}: a vertex needs three numbers`);
      verts.push(v);
    } else if (t[0] === "f") {
      const idx = t.slice(1).map((s) => {
        const i = parseInt(s.split("/")[0], 10);
        return i < 0 ? verts.length + i : i - 1;
      });
      if (idx.some((i) => !verts[i])) throw new Error(`OBJ line ${n + 1}: a face uses a vertex that does not exist`);
      for (let k = 1; k + 1 < idx.length; k++) for (const i of [idx[0], idx[k], idx[k + 1]]) out.push(...verts[i]);
    }
  }
  if (!out.length) throw new Error("No faces in the OBJ file");
  return Float32Array.from(out);
}

// GLB: every mesh primitive's POSITION (float VEC3) with its indices, placed
// by the node hierarchy (matrix or translation/rotation/scale).
export function readGlb(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("Not a GLB file");
  let off = 12, json = null, bin = null;
  while (off < bytes.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const chunk = bytes.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  if (!json || !bin) throw new Error("GLB has no geometry");
  const accessor = (i) => {
    const a = json.accessors[i];
    const bv = json.bufferViews[a.bufferView];
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const Ctor = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
    const start = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
    const stride = bv.byteStride || comps * Ctor.BYTES_PER_ELEMENT;
    const out = new Array(a.count * comps);
    const view = new DataView(bin.buffer);
    const get = { 5126: "getFloat32", 5125: "getUint32", 5123: "getUint16", 5121: "getUint8" }[a.componentType];
    for (let i = 0; i < a.count; i++) for (let c = 0; c < comps; c++) out[i * comps + c] = view[get](start + i * stride + c * Ctor.BYTES_PER_ELEMENT, true);
    return out;
  };
  const mul = (a, b) => {
    const o = new Array(16).fill(0);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  };
  const local = (n) => {
    if (n.matrix) return n.matrix;
    const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
    const [sx, sy, sz] = n.scale || [1, 1, 1];
    const [tx, ty, tz] = n.translation || [0, 0, 0];
    return [
      (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
      2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
      2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
      tx, ty, tz, 1,
    ];
  };
  const out = [];
  const visit = (ni, parent) => {
    const n = json.nodes[ni];
    const m = mul(parent, local(n));
    if (n.mesh !== undefined) {
      for (const p of json.meshes[n.mesh].primitives) {
        if (p.mode !== undefined && p.mode !== 4) continue; // triangles only
        const pos = accessor(p.attributes.POSITION);
        const idx = p.indices !== undefined ? accessor(p.indices) : [...Array(pos.length / 3).keys()];
        for (const i of idx) {
          const [x, y, z] = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
          out.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
        }
      }
    }
    for (const c of n.children || []) visit(c, m);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  const roots = scene ? scene.nodes : json.nodes.map((_, i) => i);
  for (const r of roots) visit(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  if (!out.length) throw new Error("GLB has no triangle meshes");
  return Float32Array.from(out);
}

// Content id for an asset: first 16 hex digits of its SHA-256.
export async function assetId(bytes) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...h.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
