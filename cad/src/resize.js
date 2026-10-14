// Resizing a sculpted ring, as a jeweller does (used by builds and size runs).
//
// The ring (head at +Y) gets a bore 2*dr wider. The band, everything within
// its outer radius `ro`, moves straight out from the finger axis by dr, so
// its section and the round bore are kept. The head, the material beyond the
// band at the top, is lifted rigidly by dr and keeps its exact shape. The
// two blend over the first 1.5 mm above the band, and towards the sides.

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const radialShift = (x, y, dr, ro = Infinity) => {
  const r = Math.hypot(x, y);
  if (r < 1e-9) return [x, y + dr];
  const phi = Math.abs(Math.atan2(x, y)) * (180 / Math.PI); // 0 at the top
  const w = (1 - smooth(45, 80, phi)) * smooth(ro, ro + 1.5, r); // 1: rigid lift, 0: radial
  return [x + (1 - w) * (x / r) * dr, y + w * dr + (1 - w) * (y / r) * dr];
};
// The point that radialShift moves to (x, y): for turning a click on the
// resized sculpt back into its own coordinates.
export const radialUnshift = (x, y, dr, ro = Infinity) => {
  let [px, py] = [x, y];
  for (let i = 0; i < 12; i++) {
    const [qx, qy] = radialShift(px, py, dr, ro);
    px -= qx - x;
    py -= qy - y;
  }
  return [px, py];
};
// A point and its normal moved by the same resize.
export function shiftFrame(pos, normal, shift) {
  const [x, y] = radialShift(pos.x, pos.y, shift.dr, shift.ro);
  const e = 0.05;
  const [x2, y2] = radialShift(pos.x + normal.x * e, pos.y + normal.y * e, shift.dr, shift.ro);
  const n = { x: (x2 - x) / e, y: (y2 - y) / e, z: normal.z };
  const l = Math.hypot(n.x, n.y, n.z) || 1;
  return { pos: [x, y, pos.z], normal: [n.x / l, n.y / l, n.z / l] };
}
// The band's outer radius: across the lower half of the ring (away from the
// head), the median of the outermost point in each 10° sector.
export function bandOuterRadius(positions, ri) {
  const far = new Map();
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1];
    const phi = Math.abs(Math.atan2(x, y)) * (180 / Math.PI);
    if (phi < 100) continue;
    const s = Math.floor(Math.atan2(y, x) / (Math.PI / 18));
    far.set(s, Math.max(far.get(s) ?? 0, Math.hypot(x, y)));
  }
  const v = [...far.values()].sort((a, b) => a - b);
  return v.length ? v[v.length >> 1] : ri + 1.5;
}
