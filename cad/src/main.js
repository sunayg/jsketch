import { parse, serialize, defaultDesign, setField, TEMPLATES, METALS, PROFILES, SETTINGS } from "./script.js";
import { WEIGHT, GEM_WEIGHT, LENGTH, weightIn, gemIn, lengthIn } from "./units.js";
import { build } from "./build.js";
import { report } from "./report.js";
import { CUTS } from "./gems.js";
import { createViewer } from "./viewer.js";

const $ = (id) => document.getElementById(id);
const KEY = "jewelscript.cad.v1";
const store = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (v) => { try { localStorage.setItem(KEY, v); } catch {} },
};

const prefs = { weight: "g", gem: "ct", length: "mm" };
try { Object.assign(prefs, JSON.parse(localStorage.getItem("jewelscript.units") || "{}")); } catch {}
const textarea = $("script");
let lastReport = null;
let design = defaultDesign();
let timer = null;

const viewer = createViewer($("viewport"), {
  onPaint: (stroke) => {
    if (!current().ok) return $("hint").textContent = "Fix script errors before painting.";
    design.paint.push(stroke);
    commit();
  },
});

function current() {
  const { design: d, errors } = parse(textarea.value);
  return { design: d, errors, ok: errors.length === 0 };
}

// Rebuild from the textarea. A script with errors keeps the last good model.
function rebuild() {
  const { design: d, errors, ok } = current();
  const errEl = $("errors");
  errEl.replaceChildren(...errors.map((e) => Object.assign(document.createElement("li"), { textContent: `Line ${e.line}: ${e.message}` })));
  textarea.classList.toggle("invalid", !ok);
  $("sheet").classList.toggle("stale", !ok);
  if (!ok) return;
  design = d;
  const t0 = performance.now();
  const model = build(design);
  viewer.setModel(model);
  const rep = report(model);
  lastReport = rep;
  $("rebuild").textContent = `Rebuilt in ${Math.round(performance.now() - t0)} ms`;
  renderSheet(rep);
  renderParams();
  store.set(textarea.value);
}

// UI edits write canonical script text back into the editor.
function commit() {
  textarea.value = serialize(design);
  rebuild();
}

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

function row(label, input) {
  return el("div", { className: "row" }, el("label", { textContent: label }), input);
}
function numInput(cmd, obj, key, min, max, step) {
  const i = el("input", { type: "range", min, max, step, value: obj[key], ariaLabel: key });
  const out = el("span", { textContent: obj[key] });
  i.addEventListener("input", () => (out.textContent = i.value));
  i.addEventListener("change", () => { setField(design, cmd, key, +i.value); commit(); });
  return el("span", {}, i, " ", out);
}
function selInput(cmd, obj, key, options, labelOf = (o) => o) {
  const s = el("select", { ariaLabel: key });
  for (const o of options) s.append(el("option", { value: o, textContent: labelOf(o), selected: o === obj[key] }));
  s.addEventListener("change", () => { setField(design, cmd, key, s.value); commit(); });
  return s;
}

function renderParams() {
  const root = $("params");
  root.replaceChildren();
  const sizeSel = el("input", { type: "text", value: design.ring.size, ariaLabel: "size", size: 6 });
  sizeSel.addEventListener("change", () => { setField(design, "ring", "size", sizeSel.value.toUpperCase()); delete design.ring.diameter; delete design.exprs["ring.diameter"]; commit(); });
  root.append(
    row("Ring size", sizeSel),
    row("Metal", selInput("ring", design.ring, "metal", Object.keys(METALS), (k) => METALS[k].label)),
    row("Band width", numInput("shank", design.shank, "width", 1.5, 8, 0.1)),
    row("Thickness", numInput("shank", design.shank, "thickness", 0.6, 3, 0.1)),
    row("Profile", selInput("shank", design.shank, "profile", PROFILES)),
    row("Cut", selInput("stone", design.stone, "cut", Object.keys(CUTS))),
    row("Stone width", numInput("stone", design.stone, "dia", 2, 12, 0.1)),
    row("Setting", selInput("stone", design.stone, "setting", SETTINGS)),
    row("Prongs", numInput("stone", design.stone, "prongs", 3, 8, 1)),
  );
  const halo = el("input", { type: "checkbox", checked: !!design.halo, ariaLabel: "halo" });
  halo.addEventListener("change", () => { design.halo = halo.checked ? { dia: 1.2, gap: 0.1 } : null; commit(); });
  root.append(row("Halo", halo));
  if (design.halo) root.append(row("Halo stone", numInput("halo", design.halo, "dia", 0.8, 2, 0.1)));
  const auto = el("input", { type: "checkbox", checked: design.pave.dia === "auto", ariaLabel: "auto size pavé" });
  auto.addEventListener("change", () => { setField(design, "pave", "dia", auto.checked ? "auto" : 1.3); commit(); });
  root.append(row("Pavé auto size", auto));
  if (design.pave.dia !== "auto") root.append(row("Pavé stone", numInput("pave", design.pave, "dia", 0.8, 2.5, 0.1)));
  if (design.ring.diameter !== undefined) root.append(row("Custom diameter", el("span", { textContent: `${design.ring.diameter.toFixed(2)} mm (edit in script)` })));
  if (design.vars.length) root.append(row("Variables", el("span", { textContent: design.vars.map((v) => v.name).join(", ") })));
}

function unitSelect(group, table) {
  const s = el("select", { ariaLabel: `${group} unit` });
  for (const k of Object.keys(table)) s.append(el("option", { value: k, textContent: table[k].label, selected: prefs[group] === k }));
  s.addEventListener("change", () => {
    prefs[group] = s.value;
    try { localStorage.setItem("jewelscript.units", JSON.stringify(prefs)); } catch {}
    if (lastReport) renderSheet(lastReport);
  });
  return s;
}

function renderSheet(r) {
  const root = $("sheet");
  const fx = (n, dg = 2) => n.toFixed(dg);
  const gemDigits = GEM_WEIGHT[prefs.gem].digits;
  const table = el("table", {},
    el("tr", {}, el("th", { textContent: "Stone" }), el("th", { className: "n", textContent: "mm" }), el("th", { className: "n", textContent: "qty" }), el("th", { className: "n", textContent: GEM_WEIGHT[prefs.gem].label })),
    ...r.stones.map((s) => el("tr", {}, el("td", { textContent: `${s.role} ${s.cut}` }), el("td", { className: "n", textContent: fx(s.dia, 1) }), el("td", { className: "n", textContent: s.count }), el("td", { className: "n", textContent: fx(gemIn(s.total, prefs.gem), gemDigits) }))),
  );
  root.replaceChildren(
    el("p", { className: "stale-note", textContent: "Stale: the script has errors, so this is the last valid design." }),
    row("Weight unit", unitSelect("weight", WEIGHT)),
    row("Gem unit", unitSelect("gem", GEM_WEIGHT)),
    row("Length unit", unitSelect("length", LENGTH)),
    row("Metal", el("span", { textContent: `${r.metal.name} (${fx(r.metal.density, 2)} g/cm³)` })),
    row("Weight", el("strong", { textContent: `${fx(weightIn(r.metal.weightG, prefs.weight), prefs.weight === "g" ? 2 : 3)} ${WEIGHT[prefs.weight].label}` })),
    row("Inside diameter", el("span", { textContent: `${fx(lengthIn(r.innerDiameter, prefs.length), prefs.length === "in" ? 3 : 2)} ${prefs.length}` })),
    row("Centre stone", el("span", { textContent: `${r.centre.cut} ${fx(r.centre.dia, 1)}×${fx(r.centre.length, 1)} mm` })),
    row("Stones", el("span", { textContent: `${r.stoneCount} · ${fx(gemIn(r.totalCt, prefs.gem), gemDigits)} ${GEM_WEIGHT[prefs.gem].label} est.` })),
    ...(r.paveDia ? [row("Pavé size", el("span", { textContent: `${fx(r.paveDia, 1)} mm${design.pave.dia === "auto" ? " (auto)" : ""}` }))] : []),
    ...(r.shrink ? [row("Cast shrinkage", el("span", { textContent: `+${r.shrink}% on export` }))] : []),
    table,
    el("h2", { textContent: "Checks" }),
    ...r.checks.map((c) => el("div", { className: `check ${c.level}`, textContent: c.text })),
    el("p", { className: "note", textContent: "Weights use typical alloy densities and ignore stone seats; carats are diamond estimates." }),
  );
}

function download(blob, name) {
  const a = el("a", { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const slug = () => design.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ring";

// ---- wiring ----
const sel = $("template");
for (const name of Object.keys(TEMPLATES)) sel.append(el("option", { value: name, textContent: name }));
sel.append(el("option", { value: "", textContent: "Template…", selected: true, disabled: true }));
sel.addEventListener("change", () => {
  if (!sel.value) return;
  design = TEMPLATES[sel.value]();
  commit();
  sel.value = "";
});
textarea.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(rebuild, 200);
});
$("paint-toggle").addEventListener("click", (e) => {
  const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
  e.currentTarget.setAttribute("aria-pressed", String(on));
  $("viewport").classList.toggle("painting", on);
  $("hint").textContent = on ? "Drag over the band to fill it with stones. Orbit is paused." : "";
  viewer.setPainting(on);
});
$("brush").addEventListener("input", (e) => viewer.setBrush(+e.target.value));
$("undo-paint").addEventListener("click", () => { if (current().ok) { design.paint.pop(); commit(); } });
$("clear-paint").addEventListener("click", () => { if (current().ok) { design.paint = []; commit(); } });
// Exports rebuild at the chosen quality; the script's shrink rule scales the result.
const exportModel = () => {
  const { design: d, ok } = current();
  if (!ok) { $("hint").textContent = "Fix script errors before exporting."; return null; }
  return build(d, { quality: $("quality").value });
};
$("export-stl").addEventListener("click", () => { const m = exportModel(); if (m) download(viewer.exportStl(m, "metal"), `${slug()}-metal.stl`); });
$("export-stones").addEventListener("click", () => { const m = exportModel(); if (m) download(viewer.exportStl(m, "stones"), `${slug()}-stones.stl`); });
$("export-3mf").addEventListener("click", () => { const m = exportModel(); if (m) download(viewer.export3mf(m), `${slug()}.3mf`); });
$("export-obj").addEventListener("click", () => { const m = exportModel(); if (m) download(viewer.exportObj(m), `${slug()}.obj`); });
$("export-glb").addEventListener("click", async () => { const m = exportModel(); if (m) download(await viewer.exportGlb(m), `${slug()}.glb`); });
$("theme").addEventListener("click", () => {
  const root = document.documentElement;
  const dark = root.dataset.theme !== "dark";
  root.dataset.theme = dark ? "dark" : "light";
  try { localStorage.setItem("jewelscript.theme", root.dataset.theme); } catch {}
});
try {
  const t = localStorage.getItem("jewelscript.theme");
  if (t) document.documentElement.dataset.theme = t;
} catch {}

textarea.value = store.get() || serialize(defaultDesign());
rebuild();
if (!current().ok) { textarea.value = serialize(defaultDesign()); rebuild(); } // stored script was invalid
window.__cad = { viewer, get design() { return design; } };
