// Measurements and checks from a built model.
import { METALS } from "./script.js";
import { CUTS, caratOf, isStockedMelee } from "./gems.js";
import { signedVolume } from "./build.js";

export function report(model) {
  const d = model.design;
  const metal = METALS[d.ring.metal];
  const volumeMm3 = model.metal.reduce((s, m) => s + Math.abs(signedVolume(m.geometry)), 0);
  const weightG = (volumeMm3 / 1000) * metal.density;

  const groups = new Map();
  for (const s of model.stones) {
    const key = `${s.role}|${s.cut}|${s.dia}`;
    groups.set(key, { role: s.role, cut: s.cut, dia: s.dia, count: (groups.get(key)?.count || 0) + 1, each: caratOf(s.cut, s.dia) });
  }
  const stoneList = [...groups.values()].map((g) => ({ ...g, total: g.count * g.each }));
  const totalCt = stoneList.reduce((s, g) => s + g.total, 0);

  const checks = [];
  const minWall = d.rule.min_wall;
  const thin = [{ name: "shank", v: d.shank.thickness }, ...model.metal.filter((m) => m.thickness).map((m) => ({ name: m.name, v: m.thickness }))];
  for (const p of thin) {
    if (p.v < minWall) checks.push({ level: "error", text: `${p.name} is ${p.v.toFixed(2)} mm, below the ${minWall} mm minimum wall` });
  }
  for (const g of stoneList) {
    if (g.role !== "centre" && !isStockedMelee(g.dia)) checks.push({ level: "warn", text: `${g.dia} mm ${g.role} stones are not a stocked melee size` });
  }
  const sp = model.stones.filter((s) => s.role !== "centre");
  let overlaps = 0;
  for (let i = 0; i < sp.length; i++) {
    for (let j = i + 1; j < sp.length; j++) {
      if (sp[i].pos.distanceTo(sp[j].pos) < (sp[i].dia + sp[j].dia) / 2 - 0.01) overlaps++;
    }
  }
  if (overlaps) checks.push({ level: "error", text: `${overlaps} stone pair(s) overlap` });
  if (d.stone.dia > model.geom.width * 3) checks.push({ level: "warn", text: "Centre stone is very large for this band width" });
  if (!checks.length) checks.push({ level: "ok", text: "No warnings" });

  const c = CUTS[d.stone.cut];
  return {
    innerDiameter: model.geom.innerDiameter,
    outerDiameter: model.geom.ro * 2,
    heightMm: model.geom.ro * 2 + 0.5 + 0.43 * d.stone.dia + 0.16 * d.stone.dia + 0.3,
    metal: { name: metal.label, density: metal.density, volumeMm3, weightG },
    stones: stoneList,
    stoneCount: model.stones.length,
    totalCt,
    centre: { cut: d.stone.cut, dia: d.stone.dia, length: d.stone.dia * c.aspect },
    checks,
    ok: !checks.some((x) => x.level === "error"),
  };
}
