import { parse, serialize, defaultDesign, TEMPLATES, METALS, PROFILES, SETTINGS } from "./script.js";
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

const textarea = $("script");
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
  if (!ok) return;
  design = d;
  const t0 = performance.now();
  const model = build(design);
  viewer.setModel(model);
  const rep = report(model);
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
function numInput(obj, key, min, max, step) {
  const i = el("input", { type: "range", min, max, step, value: obj[key], ariaLabel: key });
  const out = el("span", { textContent: obj[key] });
  i.addEventListener("input", () => (out.textContent = i.value));
  i.addEventListener("change", () => { obj[key] = +i.value; commit(); });
  return el("span", {}, i, " ", out);
}
function selInput(obj, key, options, labelOf = (o) => o) {
  const s = el("select", { ariaLabel: key });
  for (const o of options) s.append(el("option", { value: o, textContent: labelOf(o), selected: o === obj[key] }));
  s.addEventListener("change", () => { obj[key] = s.value; commit(); });
  return s;
}

function renderParams() {
  const root = $("params");
  root.replaceChildren();
  const sizeSel = el("input", { type: "text", value: design.ring.size, ariaLabel: "size", size: 6 });
  sizeSel.addEventListener("change", () => { design.ring.size = sizeSel.value.toUpperCase(); commit(); });
  root.append(
    row("Ring size", sizeSel),
    row("Metal", selInput(design.ring, "metal", Object.keys(METALS), (k) => METALS[k].label)),
    row("Band width", numInput(design.shank, "width", 1.5, 8, 0.1)),
    row("Thickness", numInput(design.shank, "thickness", 0.6, 3, 0.1)),
    row("Profile", selInput(design.shank, "profile", PROFILES)),
    row("Cut", selInput(design.stone, "cut", Object.keys(CUTS))),
    row("Stone width", numInput(design.stone, "dia", 2, 12, 0.1)),
    row("Setting", selInput(design.stone, "setting", SETTINGS)),
    row("Prongs", numInput(design.stone, "prongs", 3, 8, 1)),
  );
  const halo = el("input", { type: "checkbox", checked: !!design.halo, ariaLabel: "halo" });
  halo.addEventListener("change", () => { design.halo = halo.checked ? { dia: 1.2, gap: 0.1 } : null; commit(); });
  root.append(row("Halo", halo));
  if (design.halo) root.append(row("Halo stone", numInput(design.halo, "dia", 0.8, 2, 0.1)));
  root.append(row("Pavé stone", numInput(design.pave, "dia", 0.8, 2.5, 0.1)));
}

function renderSheet(r) {
  const root = $("sheet");
  const fx = (n, d = 2) => n.toFixed(d);
  const table = el("table", {},
    el("tr", {}, el("th", { textContent: "Stone" }), el("th", { className: "n", textContent: "mm" }), el("th", { className: "n", textContent: "qty" }), el("th", { className: "n", textContent: "ct" })),
    ...r.stones.map((s) => el("tr", {}, el("td", { textContent: `${s.role} ${s.cut}` }), el("td", { className: "n", textContent: fx(s.dia, 1) }), el("td", { className: "n", textContent: s.count }), el("td", { className: "n", textContent: fx(s.total, 3) }))),
  );
  root.replaceChildren(
    row("Metal", el("span", { textContent: r.metal.name })),
    row("Weight", el("strong", { textContent: `${fx(r.metal.weightG)} g` })),
    row("Inside diameter", el("span", { textContent: `${fx(r.innerDiameter)} mm` })),
    row("Centre stone", el("span", { textContent: `${r.centre.cut} ${fx(r.centre.dia, 1)}×${fx(r.centre.length, 1)} mm` })),
    row("Stones", el("span", { textContent: `${r.stoneCount} · ${fx(r.totalCt)} ct est.` })),
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
$("export-stl").addEventListener("click", () => download(viewer.exportStl("metal"), `${slug()}-metal.stl`));
$("export-stones").addEventListener("click", () => download(viewer.exportStl("stones"), `${slug()}-stones.stl`));
$("export-obj").addEventListener("click", () => download(viewer.exportObj(), `${slug()}.obj`));
$("export-glb").addEventListener("click", async () => download(await viewer.exportGlb(), `${slug()}.glb`));
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
