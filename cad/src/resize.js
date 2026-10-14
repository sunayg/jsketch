// Resizing a sculpted ring, as a jeweller does (used by builds and size runs).

// Resize a sculpt (head at +Y) the way a jeweller does: the top, where the
// head is, moves up rigidly by dr; the shank moves out from the finger axis
// by dr, keeping its section; the sides blend between the two. The bore
// changes by 2*dr, stays round, and the head keeps its exact shape.
// ri: the bore radius before resizing; metal near the bore always moves
// radially, so the finger hole stays round.
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const radialShift = (x, y, dr, ri = 0) => {
  const r = Math.hypot(x, y);
  if (r < 1e-9) return [x, y + dr];
  const phi = Math.abs(Math.atan2(x, y)) * (180 / Math.PI); // 0 at the top
  const w = (1 - smooth(35, 75, phi)) * smooth(ri + 0.8, ri + 2, r); // 1: rigid lift, 0: radial
  return [x + (1 - w) * (x / r) * dr, y + w * dr + (1 - w) * (y / r) * dr];
};
// The point that radialShift moves to (x, y): for turning a click on the
// resized sculpt back into its own coordinates.
export const radialUnshift = (x, y, dr, ri = 0) => {
  let [px, py] = [x, y];
  for (let i = 0; i < 12; i++) {
    const [qx, qy] = radialShift(px, py, dr, ri);
    px -= qx - x;
    py -= qy - y;
  }
  return [px, py];
};
// A point and its normal moved by the same resize.
export function shiftFrame(pos, normal, shift) {
  const [x, y] = radialShift(pos.x, pos.y, shift.dr, shift.ri);
  const e = 0.05;
  const [x2, y2] = radialShift(pos.x + normal.x * e, pos.y + normal.y * e, shift.dr, shift.ri);
  const n = { x: (x2 - x) / e, y: (y2 - y) / e, z: normal.z };
  const l = Math.hypot(n.x, n.y, n.z) || 1;
  return { pos: [x, y, pos.z], normal: [n.x / l, n.y / l, n.z / l] };
}
