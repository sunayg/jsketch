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

// The bore seen down an axis: points in 2D (already centred near the hole).
// Each of B angular sectors gives its innermost point; a circle through those
// (dropping sectors something pokes into) gives the centre, and the median
// sector distance the bore radius. Returns null when the centre is not
// surrounded by material, i.e. there is no hole down this axis.
const SECTORS = 72;
function boreFit(pts, start = [0, 0]) {
  let [cx, cy] = start;
  let res = null;
  for (let it = 0; it < 16; it++) {
    const mins = new Float64Array(SECTORS).fill(Infinity), at = new Array(SECTORS);
    for (const p of pts) {
      const dx = p[0] - cx, dy = p[1] - cy, d = Math.hypot(dx, dy);
      const b = Math.min(SECTORS - 1, Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * SECTORS));
      if (d < mins[b]) [mins[b], at[b]] = [d, p];
    }
    const filled = [...mins.keys()].filter((b) => Number.isFinite(mins[b]));
    if (filled.length < SECTORS * 0.75) return null;
    const sorted = filled.map((b) => mins[b]).sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    if (!(med > 0)) return null;
    // loose at first (the start can be well off-centre), then tight
    const tol = it < 4 ? 0.45 : 0.12;
    const good = filled.filter((b) => Math.abs(mins[b] - med) < tol * med);
    if (good.length < SECTORS * 0.4) {
      if (it < 4) continue;
      return null;
    }
    const c = fitCircle(good.map((b) => at[b]));
    if (!Number.isFinite(c.cx) || !Number.isFinite(c.cy)) return null;
    const moved = Math.hypot(c.cx - cx, c.cy - cy);
    [cx, cy] = [c.cx, c.cy];
    res = { cx, cy, coverage: filled.length / SECTORS };
    if (it >= 4 && moved < 1e-5 * med) break;
  }
  if (!res) return null;
  const d = pts.map((p) => Math.hypot(p[0] - res.cx, p[1] - res.cy)).sort((a, b) => a - b);
  // radius: median over sectors; rmin: the closest point of all (something
  // sticking into the hole); far: a robust outer size for the hole score
  const mins = new Float64Array(SECTORS).fill(Infinity);
  for (const p of pts) {
    const dx = p[0] - res.cx, dy = p[1] - res.cy;
    const b = Math.min(SECTORS - 1, Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * SECTORS));
    mins[b] = Math.min(mins[b], Math.hypot(dx, dy));
  }
  const sm = [...mins].filter(Number.isFinite).sort((a, b) => a - b);
  const r = sm[sm.length >> 1];
  const near = d.filter((v) => v < 4 * r); // ignore debris well away from the ring
  const far = near[Math.floor(near.length * 0.9)];
  const intruders = d.filter((v) => v < r * 0.9).length / d.length;
  return { ...res, r, rmin: d[0], far, intruders };
}
const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];

// Find the finger hole, then orient (finger axis -> Z), centre and scale the
// sculpt so its bore matches the ring's inside diameter. The axis can point
// anywhere: candidates are the principal directions of the shape and the
// file's own axes. Works in any units, and ignores debris away from the ring.
export function fitRing(pos, innerDiameter) {
  if (pos.length / 9 < 20) throw new Error("Too few triangles to find a finger hole");
  const stride = Math.max(1, Math.floor(pos.length / 3 / 60000)) * 3;
  const P = [];
  for (let i = 0; i < pos.length; i += stride) P.push([pos[i], pos[i + 1], pos[i + 2]]);
  // work in units of the shape's size so the numbers are the same in um or m
  const b = bounds(pos);
  const unitLen = Math.hypot(...b.size) || 1;
  const Q = P.map((p) => p.map((v, k) => (v - b.min[k]) / unitLen));
  const mean = [0, 1, 2].map((k) => Q.reduce((s, p) => s + p[k], 0) / Q.length);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of Q) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r][c] += (p[r] - mean[r]) * (p[c] - mean[c]);
  const axes = eigen3(C).map((e) => unit(e.vector));
  for (const w of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) if (axes.every((a) => Math.abs(dot(a, w)) < 0.995)) axes.push(w);
  const med3 = [0, 1, 2].map((k) => median(Q.map((p) => p[k])));
  const box3 = [0, 1, 2].map((k) => (b.size[k] / 2) / unitLen);
  const frame = (e) => {
    const u0 = unit(crossV(e, Math.abs(e[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    return [u0, crossV(e, u0)]; // u0 x v0 = e: right-handed
  };
  const sample = Q.length > 20000 ? Q.filter((_, i) => i % Math.ceil(Q.length / 20000) === 0) : Q;
  const tryAxis = (e, starts, pts = sample) => {
    const [u0, v0] = frame(e);
    const P2 = pts.map((p) => [dot(p, u0), dot(p, v0)]);
    let out = null;
    for (const s of starts) {
      const f = boreFit(P2, [dot(s, u0), dot(s, v0)]);
      if (!f || f.intruders > 0.03 || f.r / f.far < 0.25) continue;
      if (!out || f.r > out.r) out = { e, u0, v0, ...f, score: f.r / f.far, start: s };
    }
    return out;
  };
  // the finger hole is the widest clear opening; looking down it at a slant
  // narrows it, so the axis is refined by climbing towards a wider opening
  let best = null;
  for (const e of axes) {
    const f = tryAxis(e, [mean, med3, box3]);
    if (f && (!best || f.r > best.r)) best = f;
  }
  if (!best) throw new Error("No finger hole found: position and scale the sculpt by hand (fit=none)");
  for (const step of [8, 4, 2, 1, 0.5].map((a) => a * deg)) {
    for (let moved = true, guard = 0; moved && guard < 20; guard++) {
      moved = false;
      for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const e = unit(best.e.map((v, k) => v * Math.cos(step) + (best.u0[k] * a + best.v0[k] * c) * Math.sin(step)));
        const f = tryAxis(e, [best.start]);
        if (f && f.r > best.r * (1 + 1e-6)) {
          best = f;
          moved = true;
          break;
        }
      }
    }
  }
  best = tryAxis(best.e, [best.start], Q) ?? best;
  const { e, u0, v0, cx, cy, r } = best;
  // along the axis: the middle of the material around the hole
  const along = Q.filter((p) => Math.hypot(dot(p, u0) - cx, dot(p, v0) - cy) < 2 * r).map((p) => dot(p, e)).sort((x, y) => x - y);
  const mid = (along[Math.floor(along.length * 0.005)] + along[Math.floor(along.length * 0.995)]) / 2;
  const centre = [0, 1, 2].map((k) => b.min[k] + unitLen * (u0[k] * cx + v0[k] * cy + e[k] * mid));
  const k = innerDiameter / 2 / (r * unitLen);
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const d = [pos[i] - centre[0], pos[i + 1] - centre[1], pos[i + 2] - centre[2]];
    out[i] = dot(d, u0) * k;
    out[i + 1] = dot(d, v0) * k;
    out[i + 2] = dot(d, e) * k;
  }
  // (the head is turned to +Y later, once loose debris has been removed)
  return { positions: out, info: { fingerAxis: e.map((v) => +v.toFixed(3)), boreRadius: r * unitLen, scale: k, holeRatio: +best.score.toFixed(3) } };
}

// After repair the bore can be a little off (voxel smoothing pulls surfaces
// in): re-measure it on the finished solid and move/scale it onto the ring.
function refineBore(man, innerDiameter) {
  const mesh = man.getMesh();
  const pts = [];
  const vp = mesh.vertProperties;
  for (let i = 0; i < vp.length; i += mesh.numProp) pts.push([vp[i], vp[i + 1]]);
  const f = boreFit(pts, [0, 0]);
  if (!f) return { man, bore: null };
  const k = innerDiameter / 2 / f.r;
  const moved = man.translate([-f.cx, -f.cy, 0]);
  const scaled = moved.scale([k, k, k]);
  moved.delete();
  man.delete();
  return { man: scaled, bore: 2 * f.r * k, boreMin: 2 * f.rmin * k, correction: k };
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

// Closest distance from p to triangle abc (Ericson), with the closest point.
function pointTri(px, py, pz, t, pos, out) {
  const ax = pos[t], ay = pos[t + 1], az = pos[t + 2];
  const abx = pos[t + 3] - ax, aby = pos[t + 4] - ay, abz = pos[t + 5] - az;
  const acx = pos[t + 6] - ax, acy = pos[t + 7] - ay, acz = pos[t + 8] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let u, v; // closest = a + u*ab + v*ac
  if (d1 <= 0 && d2 <= 0) [u, v] = [0, 0];
  else {
    const bpx = px - ax - abx, bpy = py - ay - aby, bpz = pz - az - abz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = px - ax - acx, cpy = py - ay - acy, cpz = pz - az - acz;
    const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) [u, v] = [1, 0];
    else if (d6 >= 0 && d5 <= d6) [u, v] = [0, 1];
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) [u, v] = [d1 / (d1 - d3), 0];
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) [u, v] = [0, d2 / (d2 - d6)];
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      [u, v] = [1 - w, w];
    } else {
      const den = 1 / (va + vb + vc);
      [u, v] = [vb * den, vc * den];
    }
  }
  out[0] = ax + abx * u + acx * v;
  out[1] = ay + aby * u + acy * v;
  out[2] = az + abz * u + acz * v;
  return Math.hypot(px - out[0], py - out[1], pz - out[2]);
}

// Exact signed distance in a band around the surface. Each triangle's
// outward side is found from the flood fill (soups from generators often
// have flipped faces); where that is unclear the voxel sign is kept.
function exactBand(pos, phi, { origin, h, dims, outside, inside, surf }) {
  const [nx, ny, nz] = dims;
  const at = (i, j, k) => i + nx * (j + ny * k);
  const band = 1.5 * h;
  const T = pos.length / 9;
  const orient = new Int8Array(T);
  const nrm = new Float32Array(T * 3);
  const vox = (x, y, z) => {
    const i = Math.round((x - origin[0]) / h), j = Math.round((y - origin[1]) / h), k = Math.round((z - origin[2]) / h);
    return i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : at(i, j, k);
  };
  for (let t = 0; t < T; t++) {
    const o = t * 9;
    const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2];
    const vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
    let n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const l = Math.hypot(...n);
    if (!l) continue;
    n = n.map((c) => c / l);
    nrm.set(n, t * 3);
    const cx = (pos[o] + pos[o + 3] + pos[o + 6]) / 3, cy = (pos[o + 1] + pos[o + 4] + pos[o + 7]) / 3, cz = (pos[o + 2] + pos[o + 5] + pos[o + 8]) / 3;
    let score = 0;
    for (const s of [1, 2]) {
      const a = vox(cx + n[0] * s * h, cy + n[1] * s * h, cz + n[2] * s * h);
      const b = vox(cx - n[0] * s * h, cy - n[1] * s * h, cz - n[2] * s * h);
      if (a >= 0 && !surf[a]) score += outside[a] ? 1 : inside[a] ? -1 : 0;
      if (b >= 0 && !surf[b]) score += outside[b] ? -1 : inside[b] ? 1 : 0;
    }
    orient[t] = score > 0 ? 1 : score < 0 ? -1 : 0;
  }
  const ud = new Float32Array(phi.length).fill(Infinity);
  const sd = new Float32Array(phi.length);
  const q = [0, 0, 0];
  for (let t = 0; t < T; t++) {
    if (!orient[t]) continue;
    const o = t * 9;
    const lo = [0, 1, 2].map((k) => Math.max(0, Math.ceil((Math.min(pos[o + k], pos[o + 3 + k], pos[o + 6 + k]) - band - origin[k]) / h)));
    const hi = [0, 1, 2].map((k) => Math.min(dims[k] - 1, Math.floor((Math.max(pos[o + k], pos[o + 3 + k], pos[o + 6 + k]) + band - origin[k]) / h)));
    for (let k = lo[2]; k <= hi[2]; k++) for (let j = lo[1]; j <= hi[1]; j++) for (let i = lo[0]; i <= hi[0]; i++) {
      const c = at(i, j, k);
      const px = origin[0] + i * h, py = origin[1] + j * h, pz = origin[2] + k * h;
      const d = pointTri(px, py, pz, o, pos, q);
      if (d >= ud[c] || d > band) continue;
      ud[c] = d;
      // positive inside: the point is behind the face's outward side
      const side = ((px - q[0]) * nrm[t * 3] + (py - q[1]) * nrm[t * 3 + 1] + (pz - q[2]) * nrm[t * 3 + 2]) * orient[t];
      sd[c] = side > 0 ? -d : d;
    }
  }
  // the voxel distances are offset from the true ones by up to a voxel;
  // measure the offset where both are known and shift the rest to match, so
  // deeper levels (a hollow's inner wall) are at the right depth
  let sum = 0, n = 0;
  for (let c = 0; c < phi.length; c++) {
    if (ud[c] === Infinity || Math.abs(sd[c] - phi[c]) >= 1.5 * h || (sd[c] > 0) !== (phi[c] > 0)) continue;
    sum += sd[c] - phi[c];
    n++;
  }
  const shift = n ? sum / n : 0;
  const replaced = new Uint8Array(phi.length);
  for (let c = 0; c < phi.length; c++) {
    if (ud[c] === Infinity) continue;
    // keep the flood fill's verdict where the two disagree by a lot (a
    // closed hole, faces buried inside the solid); only the voxels right at
    // the boundary may change side
    const sameSide = sd[c] > 0 === phi[c] > 0;
    if (Math.abs(sd[c] - phi[c]) < 1.5 * h && (sameSide || Math.abs(phi[c]) <= 0.51 * h)) {
      phi[c] = sd[c];
      replaced[c] = 1;
    }
  }
  for (let c = 0; c < phi.length; c++) if (!replaced[c]) phi[c] += shift;
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
  // near the mesh, replace the voxel staircase with the exact distance to the
  // triangles, so the rebuilt surface follows the original instead of the grid
  exactBand(pos, phi, { origin, h, dims, outside, inside, surf });
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
  return { manifold: Manifold.levelSet(sdf, box, h, 0), voxel: h, dims };
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
  if (!soup?.length) throw new Error("The mesh has no triangles");
  const info = { inputTriangles: soup.length / 9 };
  const inner = ctx.innerDiameter ?? 17.32;
  let pos = soup;
  if (o.fit === "ring") {
    const f = fitRing(pos, inner);
    pos = f.positions;
    info.fit = f.info;
  }
  pos = transformSoup(pos, o);
  const b = bounds(pos);
  info.sizeBeforeRepair = b.size;
  const big = Math.max(...b.size);
  if (o.fit !== "ring" && (big < 5 || big > 120)) {
    info.unscaled = true;
    // a ring in micrometres or metres: don't try to voxelize or measure it
    if (big > 1000 || big < 0.5) throw new Error(`The mesh is ${big.toPrecision(3)} units across, not a ring in millimetres: use fit=ring or scale=`);
  }

  let man = null;
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
  // a broken mesh needs its holes closed, or the flood fill leaks inside
  // (and a light smoothing pass evens out the seams of the rebuild)
  let close = o.close, smooth = o.smooth;
  if (!valid && o.repair === "auto") {
    if (close < 2) close = info.autoClose = 2;
    if (smooth < 1) smooth = info.autoSmooth = 1;
  }
  const wantsVoxel = o.repair === "voxel" || smooth > 0 || o.hollow > 0 || close > 0;
  if (valid && !wantsVoxel) {
    // separate closed shells that overlap (a head modelled on top of the
    // band) are one piece of metal: union them before looking for debris
    const parts = direct.decompose();
    const bodies = parts.filter((p) => p.volume() > 0);
    const cavities = parts.filter((p) => p.volume() <= 0);
    if (bodies.length > 1) {
      const merged = Manifold.union(bodies);
      man = cavities.length ? Manifold.compose([merged, ...cavities]) : merged;
      if (cavities.length) merged.delete();
      for (const p of parts) p.delete();
    } else {
      for (const p of parts) p.delete();
      man = direct;
    }
    if (man !== direct) direct.delete();
    info.method = "direct";
  } else direct?.delete();
  if (!man) {
    if (o.repair === "none") throw new Error("The mesh is not watertight; use repair=voxel (or auto) to rebuild it");
    const r = voxelRemesh(pos, { voxel: o.voxel, close, smooth, hollow: o.hollow });
    man = r.manifold;
    info.method = "voxel";
    info.voxel = r.voxel;
  }
  if (man.isEmpty()) throw new Error("Nothing solid is left after repair: try a larger close=");
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
      const bb = m.boundingBox();
      return bb.min.every((v, k) => v >= kb.min[k] - 1e-6) && bb.max.every((v, k) => v <= kb.max[k] + 1e-6);
    };
    const removed = bodies.slice(1).map((p) => p.volume());
    info.removedPieces = removed.length;
    info.removedVolume = +removed.reduce((a, v) => a + v, 0).toFixed(3);
    const kept = [keep, ...cavities.filter(inside)];
    man.delete();
    man = kept.length > 1 ? Manifold.compose(kept) : keep;
    for (const p of parts) if (p !== man && !kept.includes(p)) p.delete();
    if (kept.length > 1) for (const p of kept) p.delete();
  } else for (const p of parts) p.delete();
  if (o.fit === "ring") {
    // turn about the finger axis so the head (the point farthest from the
    // axis) is on top, +Y; done after cleanup so debris can't win
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
    // and size the finished bore exactly
    const r = refineBore(man, inner);
    man = r.man;
    if (r.bore) Object.assign(info, { bore: +r.bore.toFixed(3), boreMin: +r.boreMin.toFixed(3), boreCorrection: +r.correction.toFixed(4) });
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
  // a hollow with no way out: casting and printing need a vent or drain
  info.cavities = man.decompose().reduce((n, m) => {
    const v = m.volume();
    m.delete();
    return n + (v < 0 ? 1 : 0);
  }, 0);
  const ob = man.boundingBox();
  Object.assign(info, { triangles: man.numTri(), volume: man.volume(), size: ob.max.map((v, k) => v - ob.min[k]) });
  return { manifold: man, info };
}
