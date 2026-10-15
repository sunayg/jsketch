// Prong tracing: find the prongs in a sculpted ring's head and describe each
// one by its own measurements, so it can be rebuilt (and later edited)
// rather than replaced by a stock prong.
//
// The head (finger axis Z, head at +Y) is sliced across, every `step` mm
// upwards from the top of the band. A prong shows up in each slice as a
// small outline of its own. Following those outlines up the slices gives a
// prong's centreline (its lean and curve), its cross-section at each height
// (an ellipse: two radii and a turn) and where its tip ends.
import { kernelModule } from "./kernel.js";

const area2 = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
};

// An outline's centre, area and best-fit ellipse (from its second moments).
function measure(poly) {
  const A = area2(poly);
  let cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    const c = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * c;
    cy += (y1 + y2) * c;
  }
  cx /= 6 * A;
  cy /= 6 * A;
  // second moments about the centre, from the outline sampled densely
  let sxx = 0, syy = 0, sxy = 0, w = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    const l = Math.hypot(x2 - x1, y2 - y1);
    const mx = (x1 + x2) / 2 - cx, my = (y1 + y2) / 2 - cy;
    sxx += mx * mx * l;
    syy += my * my * l;
    sxy += mx * my * l;
    w += l;
  }
  sxx /= w;
  syy /= w;
  sxy /= w;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det)), l2 = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const turn = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  // an ellipse's outline has mean squared radius (a² + b²)/2 along each axis
  // direction; scale the axes so the ellipse has the outline's own area
  let a = Math.sqrt(2 * Math.max(l1, 1e-9)), b = Math.sqrt(2 * Math.max(l2, 1e-9));
  const k = Math.sqrt(Math.abs(A) / (Math.PI * a * b));
  a *= k;
  b *= k;
  return { cx, cy, area: Math.abs(A), a, b, turn };
}

// Distance from a point to the nearest edge of any of the polygons.
function distToPolys(x, y, polys) {
  let d = Infinity;
  for (const poly of polys) for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l));
    d = Math.min(d, Math.hypot(x - x1 - t * dx, y - y1 - t * dy));
  }
  return d;
}

// Horizontal slices of the head from `from` up to its top. Each slice's
// outlines in (x, z), with y the slice height. Prongs that touch the stone
// or rim are bumps on a larger outline rather than outlines of their own:
// shaving off everything narrower than 2*shave (shrink, then grow back)
// leaves them as separate pieces, kept when they stand out at least
// `protrude` mm (so a rounded-off corner of the stone does not count).
export function headSlices(manifold, { from, step = 0.1, shave = 0.75, protrude = 0.35 } = {}) {
  const box = manifold.boundingBox();
  const top = box.max[1];
  const up = manifold.rotate([90, 0, 0]); // y -> z, z -> -y
  const out = [];
  const toXZ = (p) => p.map(([x, mz]) => [x, -mz]);
  for (let y = Math.max(from, box.min[1]) + step / 2; y < top; y += step) {
    const cs = up.slice(y);
    const polys = cs.toPolygons().filter((p) => area2(p) > 0).map((p) => ({ pts: toXZ(p), ...measure(toXZ(p)) }));
    if (shave > 0 && polys.some((p) => p.area > Math.PI * shave * shave * 2)) {
      const inner = cs.offset(-shave, "Round");
      const core = inner.offset(shave, "Round");
      const corePolys = core.toPolygons();
      const bumps = cs.subtract(core);
      for (const b of bumps.toPolygons()) {
        if (area2(b) <= 0.03) continue;
        const stick = Math.max(...b.map(([x, z]) => distToPolys(x, z, corePolys)));
        if (stick < protrude) continue;
        const pts = toXZ(b);
        const m = measure(pts);
        // a prong's section is compact; a shaved-off strip of a thin rim or
        // gallery wall is long and narrow (or large)
        if (m.area > 2.5 || m.a > 2.5 * m.b) continue;
        // a free-standing prong is shaved away whole: it is already listed
        if (polys.some((p) => !p.bump && p.area <= 2.5 && Math.hypot(p.cx - m.cx, p.cy - m.cy) < 0.3)) continue;
        polys.push({ pts, ...m, bump: true });
      }
      for (const c of [inner, core, bumps]) c.delete();
    }
    cs.delete();
    out.push({ y, polys });
  }
  up.delete();
  return out;
}

// Follow small outlines up the slices. An outline is a prong candidate when
// it is small (a prong is under about 1.8 mm across) and on its own; it
// continues the track whose last centre is nearest (within `reach` mm).
export function traceProngs(slices, { maxArea = 2.5, reach = 0.35, minLength = 0.8 } = {}) {
  const tracks = [];
  let open = [];
  for (const s of slices) {
    const small = s.polys.filter((p) => p.area <= maxArea && p.area > 0.01);
    const next = [];
    const used = new Set();
    for (const t of open) {
      const last = t.levels[t.levels.length - 1];
      let best = null, bd = reach;
      for (const p of small) {
        if (used.has(p)) continue;
        const d = Math.hypot(p.cx - last.cx, p.cy - last.cy);
        if (d < bd) [best, bd] = [p, d];
      }
      if (best) {
        used.add(best);
        t.levels.push({ y: s.y, ...best });
        next.push(t);
      } else tracks.push(t); // the track ended (tip, or the prong merged into something)
    }
    for (const p of small) if (!used.has(p)) next.push({ levels: [{ y: s.y, ...p }] });
    open = next;
  }
  tracks.push(...open);
  return tracks
    .filter((t) => t.levels[t.levels.length - 1].y - t.levels[0].y >= minLength)
    .map((t) => describe(t.levels));
}

// A traced prong: its centreline and section, smoothed into a few numbers
// per stretch of its length, plus how it ends.
function describe(levels) {
  const n = levels.length;
  // smooth along the length (a little): noisy AI outlines wobble
  const smooth = (f) => levels.map((_, i) => {
    let s = 0, w = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) {
      const k = 3 - Math.abs(i - j);
      s += f(levels[j]) * k;
      w += k;
    }
    return s / w;
  });
  const cx = smooth((l) => l.cx), cz = smooth((l) => l.cy), a = smooth((l) => l.a), b = smooth((l) => l.b);
  const y = levels.map((l) => l.y);
  // the ellipse's turn, unwrapped so it changes smoothly
  const turn = levels.map((l) => l.turn);
  for (let i = 1; i < n; i++) while (turn[i] - turn[i - 1] > Math.PI / 2) turn[i] -= Math.PI;
  for (let i = 1; i < n; i++) while (turn[i - 1] - turn[i] > Math.PI / 2) turn[i] += Math.PI;
  // the tip: how the section closes over the last stretch of the prong
  const rTop = Math.sqrt(a[n - 1] * b[n - 1]), rMid = Math.sqrt(a[Math.floor(n / 2)] * b[Math.floor(n / 2)]);
  const tip = rTop > rMid * 0.8 ? "flat" : rTop > rMid * 0.45 ? "round" : "pointed";
  return {
    spine: y.map((yy, i) => [cx[i], yy, cz[i]]),
    section: y.map((_, i) => ({ a: a[i], b: b[i], turn: turn[i] })),
    length: y[n - 1] - y[0],
    lean: (Math.atan2(Math.hypot(cx[n - 1] - cx[0], cz[n - 1] - cz[0]), y[n - 1] - y[0]) * 180) / Math.PI,
    radius: rMid,
    tip,
  };
}

// Rebuild a traced prong as a closed solid: its sections swept along its
// centreline, with a domed (or flat) top and the bottom pushed down into the
// metal below so it joins on. thickness scales the sections.
export function prongSolid(prong, { thickness = 1, around = 20, sink = 0.3 } = {}) {
  const { Manifold, Mesh } = kernelModule();
  const pts = prong.spine.slice(), secs = prong.section.slice();
  // sink the bottom into the metal it stands on
  pts.unshift([pts[0][0], pts[0][1] - sink, pts[0][2]]);
  secs.unshift(secs[0]);
  // the cap: a few shrinking rings above the last section
  const last = pts[pts.length - 1], ls = secs[secs.length - 1];
  const r = Math.sqrt(ls.a * ls.b) * thickness;
  const capRings = prong.tip === "flat" ? 1 : 5;
  const capH = prong.tip === "flat" ? 0.02 : prong.tip === "round" ? r * 0.9 : r * 1.6;
  for (let i = 1; i <= capRings; i++) {
    const t = i / (capRings + 1);
    const shrink = prong.tip === "pointed" ? 1 - t : Math.sqrt(1 - t * t);
    pts.push([last[0], last[1] + capH * (prong.tip === "pointed" ? t : 1 - Math.sqrt(1 - t * t) + t * 0.4), last[2]]);
    secs.push({ a: ls.a * shrink, b: ls.b * shrink, turn: ls.turn });
  }
  const verts = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, y, z] = pts[i];
    const { a, b, turn } = secs[i];
    for (let k = 0; k < around; k++) {
      const t = (k / around) * Math.PI * 2;
      const ex = a * thickness * Math.cos(t), ez = b * thickness * Math.sin(t);
      verts.push(x + ex * Math.cos(turn) - ez * Math.sin(turn), y, z + ex * Math.sin(turn) + ez * Math.cos(turn));
    }
  }
  const bottom = verts.length / 3, top = bottom + 1;
  verts.push(pts[0][0], pts[0][1], pts[0][2]);
  const tp = pts[pts.length - 1];
  verts.push(tp[0], tp[1] + (prong.tip === "flat" ? 0 : capH * 0.12), tp[2]); // just above the last ring
  const tris = [];
  const L = pts.length;
  for (let i = 0; i + 1 < L; i++) for (let k = 0; k < around; k++) {
    const p = i * around + k, q = i * around + ((k + 1) % around), r2 = (i + 1) * around + ((k + 1) % around), s = (i + 1) * around + k;
    tris.push(p, s, r2, p, r2, q);
  }
  for (let k = 0; k < around; k++) {
    // wound to match the sides
    tris.push(bottom, k, (k + 1) % around);
    tris.push(top, (L - 1) * around + ((k + 1) % around), (L - 1) * around + k);
  }
  const build = (t) => {
    // the mesh is welded by construction; merging could fuse the tiny rings
    // near a pointed tip
    const m = new Mesh({ numProp: 3, vertProperties: Float32Array.from(verts), triVerts: Uint32Array.from(t) });
    return new Manifold(m);
  };
  let solid = build(tris);
  if (solid.volume() < 0) {
    solid.delete();
    const f = [];
    for (let i = 0; i < tris.length; i += 3) f.push(tris[i], tris[i + 2], tris[i + 1]);
    solid = build(f);
  }
  return solid;
}

// Find and rebuild the prongs of a fitted ring's head. `bandTop` is the
// height above which to look (prongs stand above the band). Returns the
// prongs found and the head with its own prongs replaced by rebuilt ones.
export function rebuildProngs(head, { bandTop, thickness = 1 } = {}) {
  const { Manifold } = kernelModule();
  const prongs = traceProngs(headSlices(head, { from: bandTop }));
  if (!prongs.length) return { prongs, head };
  // take the original prongs out (a little wider than they are), then put
  // the rebuilt ones in
  const cutters = prongs.map((p) => prongSolid(p, { thickness: 1.15, sink: 0 }));
  const cut = Manifold.difference(head, Manifold.union(cutters));
  const built = prongs.map((p) => prongSolid(p, { thickness }));
  const solid = Manifold.union([cut, ...built]);
  for (const c of [...cutters, ...built]) c.delete();
  cut.delete();
  return { prongs, head: solid };
}
