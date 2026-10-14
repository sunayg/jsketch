// Self-contained, print-ready tech sheet (HTML string). Pure: the caller
// supplies rendered views (data URLs) so this also runs in Node.
import { WEIGHT, GEM_WEIGHT, LENGTH, weightIn, gemIn, lengthIn } from "./units.js";
import { METALS } from "./script.js";
import { outline } from "./gems.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ROLE_COLOR = { centre: "#1a73e8", halo: "#e37400", halo2: "#b06000", accent: "#9334e6", stroke: "#188038", region: "#d01884", pave: "#12b5cb" };

// Dimension lines drawn over an orthographic view.
function dimensioned(view, units) {
  const { px, mmPerPx, spanX, spanY } = view;
  const w = spanX / mmPerPx, h = spanY / mmPerPx;
  const x0 = (px - w) / 2, x1 = (px + w) / 2, y0 = (px - h) / 2, y1 = (px + h) / 2;
  const by = Math.min(px - 8, y1 + 16), rx = Math.min(px - 8, x1 + 16);
  const L = (mm) => `${lengthIn(mm, units.length).toFixed(units.length === "in" ? 3 : 2)} ${LENGTH[units.length].label}`;
  return `<svg class="dims" viewBox="0 0 ${px} ${px}" aria-hidden="true">
<defs><marker id="a" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="#202124"/></marker></defs>
<line x1="${x0}" y1="${by}" x2="${x1}" y2="${by}" stroke="#202124" marker-start="url(#a)" marker-end="url(#a)"/>
<text x="${px / 2}" y="${by - 4}" text-anchor="middle">${L(spanX)}</text>
<line x1="${rx}" y1="${y0}" x2="${rx}" y2="${y1}" stroke="#202124" marker-start="url(#a)" marker-end="url(#a)"/>
<text x="${rx - 4}" y="${px / 2}" text-anchor="middle" transform="rotate(-90 ${rx - 4} ${px / 2})">${L(spanY)}</text>
</svg>`;
}

// Map of every stone, coloured by group. Stones facing up are drawn from
// the top; stones on the band are drawn on the band unrolled flat (so the
// shoulders don't stack); anything else (sculpt pavé) from the front.
export function gemMapSvg(model, report, size = 420) {
  const groupIndex = new Map(report.stones.map((g, i) => [`${g.role}|${g.cut}|${g.dia}`, i + 1]));
  const top = [], band = [], front = [];
  for (const s of model.stones) {
    if (s.s !== undefined && s.w !== undefined && s.role !== "centre") band.push(s);
    else if (s.normal.y > 0.7) top.push(s);
    else front.push(s);
  }
  const panel = (title, stones, at) => {
    if (!stones.length) return "";
    const pts = stones.map(at);
    const ext = Math.max(3, ...pts.map(([x, y], i) => Math.max(Math.abs(x), Math.abs(y)) + stones[i].dia)) * 1.08;
    const k = size / (2 * ext);
    const shapes = stones.map((s, i) => {
      const color = ROLE_COLOR[s.role] || "#5f6368";
      const [x, y] = pts[i];
      const t = ((s.turn || 0) * Math.PI) / 180;
      const poly = outline(s.cut, s.dia, 0, 24).map(([ox, oz]) => {
        const [rx, rz] = [ox * Math.cos(t) - oz * Math.sin(t), ox * Math.sin(t) + oz * Math.cos(t)];
        return `${(size / 2 + (x + rx) * k).toFixed(1)},${(size / 2 + (y + rz) * k).toFixed(1)}`;
      }).join(" ");
      return `<polygon points="${poly}" fill="${color}22" stroke="${color}" stroke-width="0.8"><title>${esc(`${groupIndex.get(`${s.role}|${s.cut}|${s.dia}`)}: ${s.role} ${s.cut} ${s.dia} mm`)}</title></polygon>`;
    }).join("");
    return `<figure><svg class="gemmap" viewBox="0 0 ${size} ${size}" role="img" aria-label="Gem map, ${esc(title)}">${shapes}</svg><figcaption>${esc(title)} · ${stones.length} stone${stones.length > 1 ? "s" : ""}</figcaption></figure>`;
  };
  return `<div class="grid">${[
    panel("Top view", top, (s) => [s.pos.x, s.pos.z]),
    panel("Band, unrolled (along × across)", band, (s) => [s.s, s.w]),
    panel("Front view", front, (s) => [s.pos.x, -s.pos.y]),
  ].join("")}</div>`;
}

export function techSheetHtml({ design, report, views = [], gemMap = "", units, notes = "", logo = null, densityOverride = null, date = new Date() }) {
  const u = { weight: "g", gem: "ct", length: "mm", ...units };
  const gd = GEM_WEIGHT[u.gem].digits;
  const metal = METALS[design.ring.metal];
  const density = densityOverride ?? report.metal.density;
  const weightG = (report.metal.volumeMm3 / 1000) * density;
  const fmtW = (g) => `${weightIn(g, u.weight).toFixed(u.weight === "g" ? 2 : 3)} ${WEIGHT[u.weight].label}`;
  const fmtL = (mm) => `${lengthIn(mm, u.length).toFixed(u.length === "in" ? 3 : 2)} ${LENGTH[u.length].label}`;
  const stoneRows = report.stones
    .map((s, i) => `<tr><td>${i + 1}</td><td><span class="dot" style="background:${ROLE_COLOR[s.role] || "#5f6368"}"></span>${esc(s.role)}</td><td>${esc(s.cut)}</td><td class="n">${s.dia.toFixed(2)}</td><td class="n">${s.count}</td><td class="n">${gemIn(s.each, u.gem).toFixed(gd)}</td><td class="n">${gemIn(s.total, u.gem).toFixed(gd)}</td></tr>`)
    .join("");
  const viewHtml = views
    .map((v) => `<figure><div class="view"><img src="${v.url}" alt="${esc(v.name)} view"/>${v.mmPerPx ? dimensioned(v, u) : ""}</div><figcaption>${esc(v.name)}</figcaption></figure>`)
    .join("");
  const checks = report.checks.map((c) => `<li class="${c.level}">${esc(c.text)}</li>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(design.name)} – tech sheet</title>
<style>
:root{color-scheme:light}
body{font:13px/1.45 system-ui,sans-serif;color:#202124;background:#fff;margin:0;padding:24px;max-width:1000px;margin-inline:auto}
header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #202124;padding-bottom:8px;margin-bottom:16px}
header img{max-height:48px;max-width:180px}
h1{font-size:20px;margin:0}h2{font-size:14px;margin:18px 0 6px;text-transform:uppercase;letter-spacing:.04em}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
figure{margin:0}figcaption{text-align:center;color:#5f6368;font-size:12px}
.view{position:relative;border:1px solid #dadce0;border-radius:6px;background:#f8f9fa;aspect-ratio:1}
.view img{width:100%;height:100%;display:block}
.dims{position:absolute;inset:0;width:100%;height:100%;font-size:13px}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e8eaed;padding:4px 6px;text-align:left}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:6px 16px}
.facts div{display:flex;justify-content:space-between;border-bottom:1px dotted #dadce0}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:middle}
.gemmap{width:100%;max-width:420px;border:1px solid #dadce0;border-radius:6px;background:#fff}
li.error{color:#c5221f}li.warn{color:#b06000}li.ok{color:#188038}
.notes{white-space:pre-wrap;border:1px solid #dadce0;border-radius:6px;padding:8px}
.foot{color:#5f6368;font-size:11px;margin-top:18px}
@media print{body{padding:0}section{break-inside:avoid}.pagebreak{break-before:page}}
</style></head><body>
<header><div><h1>${esc(design.name)}</h1><div>${esc(metal.label)} · ${esc(design.ring.diameter ? `${design.ring.diameter} mm inside` : design.ring.size)} · ${date.toISOString().slice(0, 10)}</div></div>${logo ? `<img src="${logo}" alt="Logo">` : ""}</header>
<section><h2>Views</h2><div class="grid">${viewHtml}</div></section>
<section><h2>Measurements</h2><div class="facts">
<div><span>Inside diameter</span><b>${fmtL(report.innerDiameter)}</b></div>
<div><span>Outside diameter</span><b>${fmtL(report.outerDiameter)}</b></div>
<div><span>Band</span><b>${fmtL(design.shank.width)} × ${fmtL(design.shank.thickness)}</b></div>
<div><span>Thinnest shank wall</span><b>${fmtL(report.minWall.shank)}</b></div>
<div><span>Metal volume</span><b>${report.metal.volumeMm3.toFixed(1)} mm³</b></div>
<div><span>Metal weight</span><b>${fmtW(weightG)}</b></div>
${report.shrink ? `<div><span>Export shrinkage</span><b>+${report.shrink}%</b></div>` : ""}
</div></section>
<section><h2>Metal</h2><table><tr><th>Alloy</th><th class="n">Density g/cm³</th><th class="n">Weight</th></tr>
<tr><td>${esc(metal.label)}${densityOverride ? " (house density)" : ""}</td><td class="n">${density.toFixed(2)}</td><td class="n">${fmtW(weightG)}</td></tr></table></section>
<section class="pagebreak"><h2>Stones</h2><table><tr><th>#</th><th>Role</th><th>Cut</th><th class="n">mm</th><th class="n">Qty</th><th class="n">Each ${GEM_WEIGHT[u.gem].label}</th><th class="n">Total ${GEM_WEIGHT[u.gem].label}</th></tr>${stoneRows}
<tr><th colspan="4">Total</th><th class="n">${report.stoneCount}</th><th></th><th class="n">${gemIn(report.totalCt, u.gem).toFixed(gd)}</th></tr></table></section>
${gemMap ? `<section><h2>Gem map</h2>${gemMap}</section>` : ""}
<section><h2>Checks</h2><ul>${checks}</ul></section>
${notes ? `<section><h2>Notes</h2><div class="notes">${esc(notes)}</div></section>` : ""}
<p class="foot">Weights use the stated density and deduct flush stone seats. Carats are diamond estimates from stone size. Generated by JewelScript CAD.</p>
</body></html>`;
}
