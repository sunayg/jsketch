// Simple shapes standing in for a setting's metal (prongs, posts, bezels), so
// stone placement and the checks can ask "would a stone here hit metal?".
//   capsule: { a, b, r }            prism: { poly, y0, y1, frame }

export function segDist(p, a, b) {
  const ab = b.clone().sub(a);
  const t = ab.lengthSq() ? Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())) : 0;
  return a.clone().addScaledVector(ab, t).distanceTo(p);
}

// distance from a point to an outline prism (in its own frame); <= 0 inside
export function prismDist(c, p) {
  const q = p.clone().applyMatrix4(c.inv || (c.inv = c.frame.clone().invert()));
  let inside = false, edge = Infinity;
  const P = c.poly;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, zi] = P[i], [xj, zj] = P[j];
    if (zi > q.z !== zj > q.z && q.x < ((xj - xi) * (q.z - zi)) / (zj - zi) + xi) inside = !inside;
    const dx = xj - xi, dz = zj - zi;
    const t = Math.max(0, Math.min(1, ((q.x - xi) * dx + (q.z - zi) * dz) / (dx * dx + dz * dz || 1)));
    edge = Math.min(edge, Math.hypot(q.x - xi - dx * t, q.z - zi - dz * t));
  }
  const dy = q.y < c.y0 ? c.y0 - q.y : q.y > c.y1 ? q.y - c.y1 : 0;
  return inside ? (dy > 0 ? dy : -Math.min(edge, q.y - c.y0, c.y1 - q.y)) : Math.hypot(edge, dy);
}

const base = (id) => String(id).split("~")[0];

// Does a stone of radius r at p hit metal belonging to a setting other than its own?
export function hitsMetal(p, r, colliders, ownObj) {
  return colliders.some((c) => base(c.obj) !== base(ownObj) && (c.type === "prism" ? prismDist(c, p) < r : segDist(p, c.a, c.b) < c.r + r));
}
