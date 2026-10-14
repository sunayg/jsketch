// Sculpt import and repair. A sculpt (AI-generated mesh or scan) arrives as a
// triangle soup in unknown units, often with holes, overlaps and debris.
// prepareSculpt() orients and scales it, makes it a watertight solid (directly
// when it already is one, otherwise by voxel remeshing), and can smooth,
// hollow, symmetrize and simplify it.
import { kernelModule } from "./kernel.js";

const BIG = 1e20;

// ---------- transforms ----------
const deg = Math.PI / 180;
export function transformSoup(pos, { scale = 1, rx = 0, ry = 0, rz = 0, x = 0, y = 0, z = 0 } = {}) {
  const [cx, sx] = [Math.cos(rx * deg), Math.sin(rx * deg)];
  const [cy, sy] = [Math.cos(ry * deg), Math.sin(ry * deg)];
  const [cz, sz] = [Math.cos(rz * deg), Math.sin(rz * deg)];
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    let a = pos[i] * scale, b = pos[i + 1] * scale, c = pos[i + 2] * scale;
    [b, c] = [b * cx - c * sx, b * sx + c * cx]; // about x
    [a, c] = [a * cy + c * sy, -a * sy + c * cy]; // about y
    [a, b] = [a * cz - b * sz, a * sz + b * cz]; // about z
    out[i] = a + x;
    out[i + 1] = b + y;
    out[i + 2] = c + z;
  }
  return out;
}

function bounds(pos) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) {
    if (pos[i + k] < min[k]) min[k] = pos[i + k];
    if (pos[i + k] > max[k]) max[k] = pos[i + k];
  }
  return { min, max, size: max.map((v, k) => v - min[k]) };
}

// ---------- fit to ring ----------
// Least-squares circle through 2D points (Kåsa fit).
function fitCircle(pts) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  for (const [x, y] of pts) {
    const zz = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * zz; syz += y * zz; sz += zz;
  }
  const n = pts.length;
  // solve [sxx sxy sx; sxy syy sy; sx sy n] [a b c] = [sxz syz sz]
  const A = [[sxx, sxy, sx, sxz], [sxy, syy, sy, syz], [sx, sy, n, sz]];
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    for (let r = 0; r < 3; r++) {
      if (r === i || !A[i][i]) continue;
      const f = A[r][i] / A[i][i];
      for (let c = i; c < 4; c++) A[r][c] -= f * A[i][c];
    }
  }
  const a = A[0][3] / A[0][0], b = A[1][3] / A[1][1], c = A[2][3] / A[2][2];
  const cx = a / 2, cy = b / 2;
  return { cx, cy, r: Math.sqrt(Math.max(0, c + cx * cx + cy * cy)) };
}

// Eigenvectors of a symmetric 3x3 matrix (Jacobi rotations), as columns.
function eigen3(A) {
  const a = A.map((r) => r.slice());
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q];
    if (off < 1e-20) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq;
        V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  return [0, 1, 2].map((i) => ({ value: a[i][i], vector: [V[0][i], V[1][i], V[2][i]] }));
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crossV = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
  const l = Math.hypot(...a) || 1;
  return a.map((v) => v / l);
};

// Find the finger hole, then orient (finger axis -> Z, head -> +Y), centre and
// scale the sculpt so its bore matches the ring's inside diameter. The axis
// can point anywhere: candidates are the principal directions of the shape.
export function fitRing(pos, innerDiameter) {
  const stride = Math.max(1, Math.floor(pos.length / 3 / 60000)) * 3;
  const P = [];
  for (let i = 0; i < pos.length; i += stride) P.push([pos[i], pos[i + 1], pos[i + 2]]);
  const mean = [0, 1, 2].map((k) => P.reduce((s, p) => s + p[k], 0) / P.length);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of P) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r][c] += (p[r] - mean[r]) * (p[c] - mean[c]);
  const axes = eigen3(C).sort((x, y) => x.value - y.value).map((e) => unit(e.vector));
  let best = null;
  for (const e of axes) {
    const u0 = unit(crossV(e, Math.abs(e[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const v0 = crossV(e, u0); // u0 x v0 = e: right-handed
    const pts = P.map((p) => {
      const d = [p[0] - mean[0], p[1] - mean[1], p[2] - mean[2]];
      return [dot(d, u0), dot(d, v0)];
    });
    // centre: circle through the innermost points; radius: the bore itself
    // (closest distance), which is what the finger actually touches
    let cx = 0, cy = 0, r = 0;
    for (let it = 0; it < 8; it++) {
      const d = pts.map(([x, y]) => Math.hypot(x - cx, y - cy));
      const rmin = Math.min(...d);
      const inner = pts.filter((_, i) => d[i] <= rmin * 1.03 + 1e-9);
      if (inner.length < 8) break;
      const c = fitCircle(inner);
      if (!Number.isFinite(c.r)) break;
      [cx, cy] = [c.cx, c.cy];
    }
    r = Math.min(...pts.map(([x, y]) => Math.hypot(x - cx, y - cy)));
    const rmax = Math.max(...pts.map(([x, y]) => Math.hypot(x - cx, y - cy)));
    const intruders = pts.filter(([x, y]) => Math.hypot(x - cx, y - cy) < r * 0.9).length / pts.length;
    const score = intruders < 0.01 ? r / rmax : 0;
    if (!best || score > best.score) best = { e, u0, v0, cx, cy, r, score };
  }
  if (!best || best.score < 0.25) throw new Error("No finger hole found: position and scale the sculpt by hand (fit=none)");
  const { e, u0, v0, cx, cy, r } = best;
  // centre of the bore in 3D, and along the axis the middle of the shape
  const along = P.map((p) => dot([p[0] - mean[0], p[1] - mean[1], p[2] - mean[2]], e));
  const mid = (Math.min(...along) + Math.max(...along)) / 2;
  const centre = [0, 1, 2].map((k) => mean[k] + u0[k] * cx + v0[k] * cy + e[k] * mid);
  const k = innerDiameter / 2 / r;
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const d = [pos[i] - centre[0], pos[i + 1] - centre[1], pos[i + 2] - centre[2]];
    out[i] = dot(d, u0) * k;
    out[i + 1] = dot(d, v0) * k;
    out[i + 2] = dot(d, e) * k;
  }
  // (the head is turned to +Y later, once loose debris has been removed)
  return { positions: out, info: { fingerAxis: e.map((v) => +v.toFixed(3)), boreRadius: r, scale: k, holeRatio: best.score } };
}

// ---------- voxel remesh ----------
// Exact Euclidean distance transform (Felzenszwalb), squared, in voxel units.
function edt(mask, dims, featureIsSet) {
  const [nx, ny, nz] = dims;
  const N = nx * ny * nz;
  const d = new Float32Array(N);
  for (let i = 0; i < N; i++) d[i] = (mask[i] === 1) === featureIsSet ? 0 : BIG;
  const n = Math.max(nx, ny, nz);
  const f = new Float64Array(n), out = new Float64Array(n), vv = new Int32Array(n), zz = new Float64Array(n + 1);
  const pass = (len, count, index) => {
    for (let line = 0; line < count; line++) {
      for (let q = 0; q < len; q++) f[q] = d[index(line, q)];
      let k = 0;
      vv[0] = 0; zz[0] = -BIG; zz[1] = BIG;
      for (let q = 1; q < len; q++) {
        let s = (f[q] + q * q - (f[vv[k]] + vv[k] * vv[k])) / (2 * q - 2 * vv[k]);
        while (s <= zz[k]) {
          k--;
          s = (f[q] + q * q - (f[vv[k]] + vv[k] * vv[k])) / (2 * q - 2 * vv[k]);
        }
        k++;
        vv[k] = q; zz[k] = s; zz[k + 1] = BIG;
      }
      k = 0;
      for (let q = 0; q < len; q++) {
        while (zz[k + 1] < q) k++;
        out[q] = (q - vv[k]) * (q - vv[k]) + f[vv[k]];
      }
      for (let q = 0; q < len; q++) d[index(line, q)] = Math.min(out[q], BIG);
    }
  };
  pass(nx, ny * nz, (l, q) => l * nx + q);
  pass(ny, nx * nz, (l, q) => (l % nx) + q * nx + Math.floor(l / nx) * nx * ny);
  pass(nz, nx * ny, (l, q) => l + q * nx * ny);
  return d;
}

export function voxelRemesh(pos, { voxel = 0.15, close = 0, smooth = 1, hollow = 0, maxVoxels = 4e6 } = {}) {
  const { Manifold } = kernelModule();
  const b = bounds(pos);
  const pad = close + 3 + Math.ceil(smooth);
  let h = voxel;
  const count = (hh) => b.size.reduce((a, s) => a * (Math.ceil(s / hh) + 2 * pad + 1), 1);
  while (count(h) > maxVoxels) h *= 1.1; // keep memory and time bounded
  const dims = b.size.map((s) => Math.ceil(s / h) + 2 * pad + 1);
  const [nx, ny, nz] = dims;
  const N = nx * ny * nz;
  const origin = b.min.map((m) => m - pad * h);
  const at = (i, j, k) => i + nx * (j + ny * k);

  // 1. mark voxels the surface passes through
  const surf = new Uint8Array(N);
  const step = h * 0.5;
  for (let t = 0; t < pos.length; t += 9) {
    const A = [pos[t], pos[t + 1], pos[t + 2]], B = [pos[t + 3], pos[t + 4], pos[t + 5]], C = [pos[t + 6], pos[t + 7], pos[t + 8]];
    const len = Math.max(Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]), Math.hypot(C[0] - A[0], C[1] - A[1], C[2] - A[2]), Math.hypot(C[0] - B[0], C[1] - B[1], C[2] - B[2]));
    const u = Math.max(1, Math.ceil(len / step));
    for (let i = 0; i <= u; i++) for (let j = 0; j <= u - i; j++) {
      const a = i / u, bb = j / u;
      const p = [0, 1, 2].map((k) => A[k] + (B[k] - A[k]) * a + (C[k] - A[k]) * bb);
      const vi = Math.round((p[0] - origin[0]) / h), vj = Math.round((p[1] - origin[1]) / h), vk = Math.round((p[2] - origin[2]) / h);
      surf[at(vi, vj, vk)] = 1;
    }
  }
  // 2. close holes: grow the surface by `close` voxels before finding outside
  let walls = surf;
  if (close > 0) {
    const ds = edt(surf, dims, true);
    walls = new Uint8Array(N);
    for (let i = 0; i < N; i++) walls[i] = ds[i] <= close * close ? 1 : 0;
  }
  // 3. flood the outside from the grid boundary
  const outside = new Uint8Array(N);
  const queue = new Int32Array(N);
  let qh = 0, qt = 0;
  const push = (i) => {
    if (!outside[i] && !walls[i]) {
      outside[i] = 1;
      queue[qt++] = i;
    }
  };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) push(at(i, j, k));
  }
  while (qh < qt) {
    const c = queue[qh++];
    const i = c % nx, j = Math.floor(c / nx) % ny, k = Math.floor(c / (nx * ny));
    if (i > 0) push(c - 1);
    if (i < nx - 1) push(c + 1);
    if (j > 0) push(c - nx);
    if (j < ny - 1) push(c + nx);
    if (k > 0) push(c - nx * ny);
    if (k < nz - 1) push(c + nx * ny);
  }
  // 4. inside = not outside; undo the closing growth by eroding back
  const dOut = edt(outside, dims, true); // distance to the outside
  const inside = new Uint8Array(N);
  for (let i = 0; i < N; i++) inside[i] = close > 0 ? (dOut[i] > close * close ? 1 : 0) : outside[i] ? 0 : 1;
  const dIn = edt(inside, dims, true); // distance to the inside
  const dToOut = close > 0 ? edt(inside, dims, false) : dOut;

  // 5. signed distance (mm), positive inside
  let phi = new Float32Array(N);
  for (let i = 0; i < N; i++) phi[i] = (inside[i] ? Math.sqrt(dToOut[i]) - 0.5 : -(Math.sqrt(dIn[i]) - 0.5)) * h;
  // 6. smoothing: separable [1 2 1] passes
  for (let s = 0; s < smooth; s++) {
    for (const [stride, len] of [[1, nx], [nx, ny], [nx * ny, nz]]) {
      const next = new Float32Array(phi);
      for (let c = 0; c < N; c++) {
        const coord = Math.floor(c / stride) % len;
        if (coord === 0 || coord === len - 1) continue;
        next[c] = 0.25 * phi[c - stride] + 0.5 * phi[c] + 0.25 * phi[c + stride];
      }
      phi = next;
    }
  }
  // 7. hollow: keep a shell `hollow` mm thick under the surface
  if (hollow > 0) for (let i = 0; i < N; i++) phi[i] = Math.min(phi[i], hollow - phi[i]);

  const sdf = ([x, y, z]) => {
    const fx = (x - origin[0]) / h, fy = (y - origin[1]) / h, fz = (z - origin[2]) / h;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    if (i < 0 || j < 0 || k < 0 || i >= nx - 1 || j >= ny - 1 || k >= nz - 1) return -h;
    const tx = fx - i, ty = fy - j, tz = fz - k;
    const g = (a, bb, c) => phi[at(i + a, j + bb, k + c)];
    const x00 = g(0, 0, 0) * (1 - tx) + g(1, 0, 0) * tx, x10 = g(0, 1, 0) * (1 - tx) + g(1, 1, 0) * tx;
    const x01 = g(0, 0, 1) * (1 - tx) + g(1, 0, 1) * tx, x11 = g(0, 1, 1) * (1 - tx) + g(1, 1, 1) * tx;
    return (x00 * (1 - ty) + x10 * ty) * (1 - tz) + (x01 * (1 - ty) + x11 * ty) * tz;
  };
  const box = { min: origin, max: origin.map((o, k) => o + (dims[k] - 1) * h) };
  return { manifold: Manifold.levelSet(sdf, box, h, h * 0.5), voxel: h, dims };
}

function soupToManifold(pos) {
  const { Manifold, Mesh } = kernelModule();
  const n = pos.length / 3;
  const tri = new Uint32Array(n);
  for (let i = 0; i < n; i++) tri[i] = i;
  const mesh = new Mesh({ numProp: 3, vertProperties: Float32Array.from(pos), triVerts: tri });
  mesh.merge();
  return new Manifold(mesh);
}

// ---------- the pipeline ----------
// opts: fit ring|none, scale, rx, ry, rz, x, y, z, repair auto|voxel|none,
// voxel, close, smooth, keep largest|all, hollow, symmetrize none|x+|x-,
// simplify yes|no. ctx.innerDiameter is the ring's bore for fit=ring.
export function prepareSculpt(soup, opts = {}, ctx = {}) {
  const { Manifold } = kernelModule();
  const o = { fit: "none", repair: "auto", voxel: 0.15, close: 0, smooth: 0, keep: "largest", hollow: 0, symmetrize: "none", simplify: "yes", ...opts };
  const info = { inputTriangles: soup.length / 9 };
  let pos = soup;
  if (o.fit === "ring") {
    const f = fitRing(pos, ctx.innerDiameter ?? 17.32);
    pos = f.positions;
    info.fit = f.info;
  }
  pos = transformSoup(pos, o);
  const b = bounds(pos);
  info.sizeBeforeRepair = b.size;
  if (o.fit !== "ring" && (Math.max(...b.size) < 5 || Math.max(...b.size) > 120)) info.unscaled = true;

  let man = null;
  const wantsVoxel = o.repair === "voxel" || o.smooth > 0 || o.hollow > 0 || o.close > 0;
  // always check whether the input is already a closed solid (cheap), so
  // the report can say so even when a voxel rebuild was asked for
  let direct = null;
  try {
    direct = soupToManifold(pos); // throws when the mesh is not a closed solid
  } catch {
    direct = null;
  }
  const valid = direct && String(direct.status()) === "NoError" && !direct.isEmpty() && direct.volume() > 0;
  info.notWatertight = !valid;
  if (valid && !wantsVoxel) {
    man = direct;
    info.method = "direct";
  } else direct?.delete();
  if (!man) {
    if (o.repair === "none") throw new Error("The mesh is not watertight; use repair=voxel (or auto) to rebuild it");
    const r = voxelRemesh(pos, { voxel: o.voxel, close: o.close, smooth: o.smooth, hollow: o.hollow });
    man = r.manifold;
    info.method = "voxel";
    info.voxel = r.voxel;
  }
  // keep the largest piece (debris, floaters)
  const parts = man.decompose();
  // a hollow solid decomposes into its outer body plus inner cavities
  // (negative volume); keep the largest body together with its cavities
  const bodies = parts.filter((p) => p.volume() > 0).sort((a, c) => c.volume() - a.volume());
  const cavities = parts.filter((p) => p.volume() <= 0);
  info.pieces = bodies.length;
  if (o.keep === "largest" && bodies.length > 1) {
    const keep = bodies[0];
    const kb = keep.boundingBox();
    const inside = (m) => {
      const b = m.boundingBox();
      return b.min.every((v, k) => v >= kb.min[k] - 1e-6) && b.max.every((v, k) => v <= kb.max[k] + 1e-6);
    };
    info.removedPieces = bodies.slice(1).map((p) => +p.volume().toFixed(3));
    const kept = [keep, ...cavities.filter(inside)];
    man.delete();
    man = kept.length > 1 ? Manifold.compose(kept) : keep;
    for (const p of parts) if (p !== man) p.delete();
  } else for (const p of parts) p.delete();
  // fitted rings: turn about the finger axis so the head (the point farthest
  // from the axis) is on top, +Y; done after cleanup so debris can't win
  if (o.fit === "ring") {
    const mesh = man.getMesh();
    let far = 0, fx = 0, fy = 1;
    for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp) {
      const x = mesh.vertProperties[i], y = mesh.vertProperties[i + 1];
      const d = Math.hypot(x, y);
      if (d > far) [far, fx, fy] = [d, x, y];
    }
    const turned = man.rotate([0, 0, (Math.atan2(fx, fy) * 180) / Math.PI]);
    man.delete();
    man = turned;
  }
  // symmetrize: keep one half and mirror it across x = 0
  if (o.symmetrize === "x+" || o.symmetrize === "x-") {
    const n = o.symmetrize === "x+" ? [1, 0, 0] : [-1, 0, 0];
    const half = man.trimByPlane(n, 0);
    const both = Manifold.union(half, half.mirror([1, 0, 0]));
    man.delete();
    half.delete();
    man = both;
  }
  if (o.simplify !== "no") {
    const s = man.simplify((info.voxel ?? 0.05) * 0.25);
    man.delete();
    man = s;
  }
  const ob = man.boundingBox();
  Object.assign(info, { triangles: man.numTri(), volume: man.volume(), size: ob.max.map((v, k) => v - ob.min[k]) });
  return { manifold: man, info };
}
