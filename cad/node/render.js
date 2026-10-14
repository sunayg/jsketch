// Software renderer: draws a built model to a PNG in Node (no GPU, no deps).
// Flat-shaded triangles with a z-buffer, orthographic camera.
import zlib from "node:zlib";
import * as THREE from "three";
import { stoneGeometry } from "../src/gems.js";
import { stoneMatrix } from "../src/build.js";
import { METALS } from "../src/script.js";
import { crc32 } from "../src/zip.js";

const VIEWS = {
  iso: { dir: [-26, -22, -38], up: [0, 1, 0] },
  top: { dir: [0, -1, 0], up: [0, 0, -1] },
  front: { dir: [0, 0, -1], up: [0, 1, 0] },
  side: { dir: [-1, 0, 0], up: [0, 1, 0] },
};

function png(width, height, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // no filter
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function triangles(model) {
  const out = [];
  const push = (geo, color, kind) => {
    const p = geo.attributes.position;
    const idx = geo.index;
    const n = idx ? idx.count : p.count;
    for (let i = 0; i < n; i += 3) {
      const v = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(p, idx ? idx.getX(i + k) : i + k));
      out.push({ v, color, kind });
    }
  };
  const metal = new THREE.Color(METALS[model.design.ring.metal].color);
  for (const m of model.metal) push(m.geometry, metal, "metal");
  const gem = new THREE.Color("#cfe6ff");
  const cache = new Map();
  for (const s of model.stones) {
    const k = `${s.cut}|${s.dia}`;
    if (!cache.has(k)) cache.set(k, stoneGeometry(s.cut, s.dia));
    push(cache.get(k).clone().applyMatrix4(stoneMatrix(s)), gem, "stone");
  }
  return out;
}

export function renderPng(model, { view = "iso", size = 512 } = {}) {
  const cfg = VIEWS[view] || VIEWS.iso;
  const dir = new THREE.Vector3(...cfg.dir).normalize(); // camera looks along dir
  const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(...cfg.up)).normalize();
  const up = new THREE.Vector3().crossVectors(right, dir).normalize();
  const light = new THREE.Vector3(0.4, 0.8, 0.6).normalize();
  const tris = triangles(model);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of tris) for (const v of t.v) {
    const x = v.dot(right), y = v.dot(up);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const scale = (size * 0.9) / Math.max(maxX - minX, maxY - minY, 1e-6);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const rgba = Buffer.alloc(size * size * 4, 255);
  const zbuf = new Float32Array(size * size).fill(-Infinity);
  for (const t of tris) {
    const p = t.v.map((v) => [size / 2 + (v.dot(right) - cx) * scale, size / 2 - (v.dot(up) - cy) * scale, -v.dot(dir)]);
    const n = new THREE.Vector3().subVectors(t.v[1], t.v[0]).cross(new THREE.Vector3().subVectors(t.v[2], t.v[0])).normalize();
    const facing = Math.abs(n.dot(dir));
    const lit = 0.35 + 0.5 * Math.abs(n.dot(light)) + 0.15 * facing;
    const sparkle = t.kind === "stone" ? 0.1 : 0;
    const r = Math.min(255, (t.color.r * lit + sparkle) * 255), g = Math.min(255, (t.color.g * lit + sparkle) * 255), b = Math.min(255, (t.color.b * lit + sparkle) * 255);
    const x0 = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0]))), x1 = Math.min(size - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])));
    const y0 = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1]))), y1 = Math.min(size - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])));
    const area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((p[1][0] - px) * (p[2][1] - py) - (p[2][0] - px) * (p[1][1] - py)) / area;
        const w1 = ((p[2][0] - px) * (p[0][1] - py) - (p[0][0] - px) * (p[2][1] - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * p[0][2] + w1 * p[1][2] + w2 * p[2][2];
        const i = y * size + x;
        if (z <= zbuf[i]) continue;
        zbuf[i] = z;
        rgba[i * 4] = r;
        rgba[i * 4 + 1] = g;
        rgba[i * 4 + 2] = b;
        rgba[i * 4 + 3] = 255;
      }
    }
  }
  return png(size, size, rgba);
}
