import * as THREE from "three";

// width is the stone's smaller dimension (the "dia" in the script).
// aspect = length / width. k estimates diamond carats as k * width^3 * aspect.
export const CUTS = {
  round: { aspect: 1, segments: 24, k: 0.00364, smooth: true },
  oval: { aspect: 1.35, segments: 24, k: 0.004, smooth: true },
  marquise: { aspect: 2, segments: 24, k: 0.004, smooth: true },
  pear: { aspect: 1.55, segments: 24, k: 0.0039, smooth: true },
  princess: { aspect: 1, segments: 4, k: 0.006, smooth: false },
  cushion: { aspect: 1, segments: 8, k: 0.006, smooth: false },
  emerald: { aspect: 1.4, segments: 4, k: 0.0057, smooth: false },
};

export const MELEE_SIZES = [0.8, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 2.0, 2.2, 2.5, 3.0];

export const caratOf = (cut, dia) => CUTS[cut].k * dia ** 3 * CUTS[cut].aspect;
export const isStockedMelee = (dia) => MELEE_SIZES.some((s) => Math.abs(s - dia) < 1e-6);

// Girdle plane at y = 0, table up, culet down. Proportions follow a standard
// round brilliant: table 57%, crown 16%, pavilion 43%, girdle 3%.
export function stoneGeometry(cut, dia) {
  const c = CUTS[cut];
  const polygon = !c.smooth;
  // polygonal cuts: scale so the *side* equals the width, not the diagonal
  const R = polygon && c.segments === 4 ? dia / Math.SQRT2 : dia / 2;
  const g = 0.015 * dia * 2;
  const pts = [
    new THREE.Vector2(0.0001, -0.43 * dia),
    new THREE.Vector2(R, -g / 2),
    new THREE.Vector2(R, g / 2),
    new THREE.Vector2(R * 0.57 * 1.05, 0.16 * dia + g / 2),
    new THREE.Vector2(0.0001, 0.16 * dia + g / 2),
  ];
  const geo = new THREE.LatheGeometry(pts, c.segments);
  if (polygon && c.segments === 4) geo.rotateY(Math.PI / 4);
  geo.scale(1, 1, c.aspect);
  if (cut === "pear") taperPear(geo, dia, c.aspect);
  return geo.toNonIndexed();
}

// Pear: narrow the points toward -z end (the tip).
function taperPear(geo, dia, aspect) {
  const p = geo.attributes.position;
  const half = (dia * aspect) / 2;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    const t = (z + half) / (2 * half); // 0 at tip, 1 at round end
    p.setX(i, p.getX(i) * (0.25 + 0.75 * Math.sqrt(Math.max(t, 0))));
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
}

// Closed girdle outline in the xz plane, offset outward by `off` mm.
// Returns an array of [x, z]. Smooth cuts are sampled finely; polygon cuts
// return rounded-corner-free offsets with the corners retained.
export function outline(cut, dia, off = 0) {
  const c = CUTS[cut];
  const w = dia / 2 + off;
  const l = (dia * c.aspect) / 2 + off;
  const out = [];
  if (c.smooth) {
    const N = 360;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      let x = Math.cos(a) * w;
      const z = Math.sin(a) * l;
      if (cut === "pear") {
        const t = (z + l) / (2 * l);
        x *= 0.25 + 0.75 * Math.sqrt(Math.max(t, 0));
      }
      out.push([x, z]);
    }
    return out;
  }
  if (c.segments === 4) {
    return [[w, l], [-w, l], [-w, -l], [w, -l]];
  }
  // cushion: octagon with cut corners
  const k = w * 0.35;
  return [
    [w - k, l], [-(w - k), l], [-w, l - k], [-w, -(l - k)],
    [-(w - k), -l], [w - k, -l], [w, -(l - k)], [w, l - k],
  ];
}

// Evenly spaced points along a closed polyline, spacing >= minPitch.
export function spaceAlong(poly, minPitch) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push({ a, b, len, start: total });
    total += len;
  }
  const n = Math.max(1, Math.floor(total / minPitch));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const d = (i / n) * total;
    const s = segs.find((q) => d >= q.start && d < q.start + q.len) || segs[segs.length - 1];
    const t = s.len ? (d - s.start) / s.len : 0;
    pts.push([s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t]);
  }
  return { pts, perimeter: total, pitch: total / n };
}
