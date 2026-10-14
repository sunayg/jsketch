import * as THREE from "three";
import { parse, serialize, mergeText, defaultDesign, setField, METALS, PROFILES, SETTINGS, TIPS, HALO_KINDS, LISTS, SCHEMA } from "./script.js";
import { WEIGHT, GEM_WEIGHT, LENGTH, weightIn, gemIn, lengthIn } from "./units.js";
import { build } from "./build.js";
import { report } from "./report.js";
import { CUTS } from "./gems.js";
import { createViewer } from "./viewer.js";
import { DESIGNS, COMPONENTS, search } from "./library.js";
import { interpret } from "./assistant.js";
import { techSheetHtml, gemMapSvg } from "./techsheet.js";
import { sizeRun, sizeRange, bundle, stlBytes } from "./export.js";
import { importFile } from "./importers.js";
import { parseSize, sizeFromDiameter } from "./sizes.js";
import { sculptKey } from "./build.js";
import { putAsset } from "./assets-idb.js";
import { assetId, readMesh } from "./meshio.js";
import { innerDiameterOf } from "./sculpts.js";

const $ = (id) => document.getElementById(id);
const KEY = "jewelscript.cad.v1"; // last valid script
const DRAFT = "jewelscript.cad.draft"; // whatever is in the editor, even with errors
const store = {
  get: (k = KEY) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (v, k = KEY) => { try { localStorage.setItem(k, v); } catch {} },
};
const prefs = { weight: "g", gem: "ct", length: "mm" };
try {
  const saved = JSON.parse(store.get("jewelscript.units") || "{}");
  for (const [k, table] of [["weight", WEIGHT], ["gem", GEM_WEIGHT], ["length", LENGTH]]) if (saved[k] in table) prefs[k] = saved[k];
} catch {}

const textarea = $("script");
let design = defaultDesign();
let model = null;
let lastReport = null;
let timer = null;
let selected = null;

// ---------- history (undo/redo over script text) ----------
const history = { past: [], future: [], last: null, batching: false };
const HISTORY = "jewelscript.history";
function saveHistory() {
  store.set(JSON.stringify({ past: history.past.slice(-30), last: history.last }), HISTORY);
}
function remember(text) {
  queueMicrotask(saveHistory);
  // during a paint drag every dab rebuilds, but the whole drag is one undo step
  if (history.batching && history.batchStarted) {
    history.last = text;
    return;
  }
  if (history.batching) history.batchStarted = true;
  if (history.last !== null && history.last !== text) {
    history.past.push(history.last);
    if (history.past.length > 200) history.past.shift();
    history.future = [];
  }
  history.last = text;
}
// Keep the editor text (even if it has errors) before replacing the whole design.
function snapshotRaw() {
  if (textarea.value !== history.last) {
    if (history.last !== null) history.past.push(history.last);
    history.last = textarea.value;
    history.future = [];
  }
}
function replaceText(text, message) {
  snapshotRaw();
  textarea.value = text;
  rebuild();
  viewer.fit();
  if (message) say(`${message} Undo brings back the previous script.`);
}
function undo() {
  if (!history.past.length) return say("Nothing to undo.");
  history.future.push(history.last);
  history.last = history.past.pop();
  textarea.value = history.last;
  rebuild({ record: false });
}
function redo() {
  if (!history.future.length) return say("Nothing to redo.");
  history.past.push(history.last);
  history.last = history.future.pop();
  textarea.value = history.last;
  rebuild({ record: false });
}

const say = (msg) => ($("hint").textContent = msg);

// ---------- exact solid (Manifold, in a worker) ----------
// The viewport and a quick estimate update instantly; the worker then builds
// the true solid (parts unioned, seats cut) and the report switches to exact.
let worker = null;
try {
  worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
} catch {
  worker = null;
}
const exactState = { busy: false, queued: null, current: null, waiters: [], seq: 0 };
function requestExact(text) {
  if (!worker) return;
  exactState.queued = text;
  clearTimeout(exactState.timer);
  exactState.timer = setTimeout(pumpExact, 250);
  setExactStatus("Computing exact solid…");
}
function pumpExact() {
  if (exactState.busy || exactState.queued === null) return;
  const text = exactState.queued;
  exactState.queued = null;
  exactState.busy = true;
  worker.postMessage({ kind: "exact", id: ++exactState.seq, text });
  exactState.inflight = text;
}

// Sculpts are prepared (repaired, fitted) in the worker once per file and
// options; until then the design shows "preparing…".
const sculptCache = new Map(); // full key -> { geometry, info } | { pending } | { error }
const sculptFullKey = (d, sc) => `${sculptKey(sc)}|${sc.fit === "ring" ? innerDiameterOf(d).toFixed(4) : ""}`;
let sculptSeq = 0;
const sculptJobs = new Map();
function sculptsFor(d) {
  const out = new Map();
  for (const sc of d.sculpts) {
    const key = sculptFullKey(d, sc);
    if (!sculptCache.has(key)) {
      if (!worker) sculptCache.set(key, { error: "sculpts need the solid kernel, which did not load" });
      else {
        sculptCache.set(key, { pending: true });
        const id = ++sculptSeq;
        sculptJobs.set(id, key);
        worker.postMessage({ kind: "sculpt", id, sculpt: sc, innerDiameter: innerDiameterOf(d) });
        say(`Preparing sculpt ${sc.id}…`);
      }
    }
    out.set(sculptKey(sc), sculptCache.get(key));
  }
  return out;
}
function onSculptReady(msg) {
  const key = sculptJobs.get(msg.id);
  sculptJobs.delete(msg.id);
  if (!key) return;
  if (msg.error) sculptCache.set(key, { error: msg.error });
  else {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(msg.positions, 3));
    g.computeVertexNormals();
    g.userData.thickness = msg.thickness;
    sculptCache.set(key, { geometry: g, info: msg.info });
    say(`Sculpt ready in ${(msg.info.ms / 1000).toFixed(1)} s (${msg.info.method === "voxel" ? "rebuilt as a solid" : "already a solid"}, ${msg.info.triangles} triangles).`);
  }
  rebuild({ record: false });
}
if (worker) {
  worker.onmessage = (e) => {
    if (e.data.kind === "sculpt") return onSculptReady(e.data);
    exactState.busy = false;
    const text = exactState.inflight;
    if (!e.data.error && text === textarea.value && model) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(e.data.positions, 3));
      g.computeVertexNormals();
      model.solidGeometry = g;
      model.exact = e.data.exact;
      exactState.current = text;
      lastReport = report(model, e.data.exact);
      renderSheet(lastReport);
      renderObjects();
      setExactStatus(`Exact solid in ${Math.round(e.data.exact.ms)} ms`);
      for (const w of exactState.waiters.splice(0)) w(true);
    } else if (e.data.error) {
      setExactStatus("Exact solid unavailable; showing estimates");
    }
    pumpExact();
  };
  worker.onerror = () => {
    worker = null;
    setExactStatus("Exact solid unavailable; showing estimates");
  };
}
function setExactStatus(t) {
  const el = document.getElementById("exact-status");
  if (el) el.textContent = t;
}
// Resolves once the exact solid for the current script is in (or gives up).
function ensureExact() {
  if (!worker || exactState.current === textarea.value) return Promise.resolve(!!worker);
  return new Promise((res) => {
    exactState.waiters.push(res);
    setTimeout(() => res(false), 20000);
  });
}

// ---------- viewer and tools ----------
const nextId = (prefix) => {
  const ids = new Set(Object.values(LISTS).flatMap((k) => design[k].map((o) => o.id)));
  let i = 1;
  while (ids.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
};
const needValid = () => {
  if (current().ok) return true;
  say("Fix the script errors first.");
  return false;
};
const simplify = (pts, maxPts = 40) => {
  const step = Math.max(1, Math.ceil(pts.length / maxPts));
  const out = pts.filter((_, i) => i % step === 0);
  if (out.at(-1) !== pts.at(-1)) out.push(pts.at(-1));
  return out.map(([s, w]) => [Math.round(s * 10) / 10, Math.round(w * 10) / 10]);
};
const paveDia = () => (typeof design.pave.dia === "number" ? design.pave.dia : 1.3);

const surfaceDrag = { id: null };
const viewer = createViewer($("viewport"), {
  onPaint: (dabs) => {
    if (!needValid()) return;
    history.batching = true;
    design.paint.push(...dabs);
    commit();
  },
  onPaintEnd: () => {
    history.batching = false;
    history.batchStarted = false;
  },
  onStroke: (pts) => {
    if (!needValid()) return;
    const id = nextId("row");
    design.strokes.push({ id, dia: paveDia(), gap: 0.15, setting: "bead", bead: 0.35, mirror: "no", pts: simplify(pts) });
    commit();
    say(`Added stroke ${id}. Edit its count, size or setting in the script.`);
  },
  onOutline: (pts) => {
    if (!needValid()) return;
    const id = nextId("region");
    design.regions.push({ id, dia: "auto", gap: 0.12, setting: "bead", bead: 0.35, mirror: "no", pts: simplify(pts), min: 0.9, max: 1.5 });
    commit();
    say(`Added ${id}, auto-sized. Set dia= in the script to fix a size.`);
  },
  onWand: ({ s, span }) => {
    if (!needValid()) return;
    const id = nextId("wand");
    const h = Math.round((design.shank.width / 2 - 0.05) * 100) / 100;
    design.regions.push({ id, dia: "auto", gap: 0.12, setting: "bead", bead: 0.35, mirror: "no", pts: [[s - span, -h], [s + span, -h], [s + span, h], [s - span, h]].map(([a, b]) => [Math.round(a * 10) / 10, b]), min: 0.9, max: 1.5 });
    commit();
    say(`Filled ${id} across the band (${(2 * span).toFixed(1)} mm long).`);
  },
  // painting on a sculpt: one surfpave per drag, dabs in 3D
  onSurfacePaint: (on, dabs) => {
    if (!needValid()) return;
    history.batching = true;
    let sp = design.surfpaves.find((x) => x.id === surfaceDrag.id);
    if (!sp) {
      sp = { id: nextId("surf"), on, r: viewer.brush, dia: "auto", gap: 0.12, setting: "bead", bead: 0.35, mirror: "no", pts: [], min: 0.9, max: 1.5 };
      design.surfpaves.push(sp);
      surfaceDrag.id = sp.id;
    }
    sp.pts.push(...dabs.map((p) => p.map((v) => Math.round(v * 100) / 100)));
    commit();
  },
  onSurfaceEnd: () => {
    surfaceDrag.id = null;
    history.batching = false;
    history.batchStarted = false;
  },
  onMeasure: ({ mm }) => say(mm == null ? "Measure: click a second point." : `Distance: ${mm.toFixed(2)} mm${prefs.length === "mm" ? "" : ` (${lengthIn(mm, prefs.length).toFixed(prefs.length === "in" ? 3 : 2)} ${prefs.length})`}`),
});

const TOOL_HINTS = {
  orbit: "",
  paint: "Brush: drag over the band to paint pavé. Orbit is paused.",
  stroke: "Stroke: drag along the band to place one row of stones.",
  outline: "Outline: drag a closed loop on the band to fill it.",
  wand: "Wand: click the band to fill across its full width (span sets the length).",
  measure: "Measure: click two points on the model.",
  surface: "Surface: drag over a sculpt to fill it with pavé (auto-sized). Orbit is paused.",
};
function setTool(t) {
  for (const b of document.querySelectorAll("[data-tool]")) b.setAttribute("aria-pressed", String(b.dataset.tool === t));
  $("viewport").classList.toggle("painting", t !== "orbit");
  viewer.setTool(t);
  say(TOOL_HINTS[t]);
}

// ---------- rebuild ----------
function current() {
  const { design: d, errors } = parse(textarea.value);
  return { design: d, errors, ok: errors.length === 0 };
}

// Rebuild from the textarea. A script with errors keeps the last good model.
function rebuild({ record = true } = {}) {
  const { design: d, errors, ok } = current();
  $("errors").replaceChildren(...errors.map((e) => {
    const li = el("li", {}, el("button", { type: "button", className: "link", textContent: `Line ${e.line}` }), `: ${e.message}`);
    li.querySelector("button").addEventListener("click", () => selectLine(e.line));
    return li;
  }));
  textarea.classList.toggle("invalid", !ok);
  $("sheet").classList.toggle("stale", !ok);
  $("params-set").disabled = !ok;
  $("params-note").hidden = ok;
  store.set(textarea.value, DRAFT);
  if (!ok) {
    if (!model) showFallbackModel();
    return;
  }
  if (record) remember(textarea.value);
  design = d;
  const t0 = performance.now();
  model = build(design, { sculpts: sculptsFor(design) });
  viewer.setModel(model);
  lastReport = report(model);
  $("rebuild").textContent = `Rebuilt in ${Math.round(performance.now() - t0)} ms`;
  exactState.current = null;
  requestExact(textarea.value);
  renderSheet(lastReport);
  renderParams();
  renderObjects();
  store.set(textarea.value);
}

// UI edits change only the affected script lines; comments and order stay.
// Refused while the script has errors, so typed text is never overwritten.
function commit() {
  if (!current().ok) {
    say("The script has errors: fix them (or Undo) before editing with the panel or tools.");
    return false;
  }
  textarea.value = mergeText(textarea.value, design);
  rebuild();
  return true;
}

// A draft with errors still shows the last valid design in the viewport.
function showFallbackModel() {
  const saved = parse(store.get() || "");
  design = saved.errors.length ? defaultDesign() : saved.design;
  model = build(design, { sculpts: sculptsFor(design) });
  viewer.setModel(model);
  lastReport = report(model);
  renderSheet(lastReport);
  renderParams();
  renderObjects();
}

function selectLine(n) {
  const lines = textarea.value.split("\n");
  const start = lines.slice(0, n - 1).reduce((a, l) => a + l.length + 1, 0);
  textarea.focus();
  textarea.setSelectionRange(start, start + (lines[n - 1] || "").length);
  showTab("script");
}

// ---------- small DOM helpers ----------
function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}
const row = (label, input) => el("div", { className: "row" }, el("label", { textContent: label }), input);
function numInput(cmd, obj, key, min, max, step) {
  const v = typeof obj[key] === "number" ? obj[key] : min;
  const i = el("input", { type: "range", min, max, step, value: v, ariaLabel: `${cmd} ${key}` });
  const out = el("span", { className: "val", textContent: v });
  const expr = (cmd in LISTS ? obj.exprs?.[key] : design.exprs[`${cmd}.${key}`]);
  if (expr) out.textContent = `${v} ƒ`, (out.title = `${expr}: editing replaces the expression`);
  i.addEventListener("input", () => (out.textContent = i.value));
  i.addEventListener("change", () => {
    setField(design, cmd, key, +i.value);
    commit();
  });
  return el("span", { className: "num" }, i, out);
}
function selInput(cmd, obj, key, options, labelOf = (o) => o) {
  const s = el("select", { ariaLabel: `${cmd} ${key}` });
  for (const o of options) s.append(el("option", { value: o, textContent: labelOf(o), selected: o === (obj[key] ?? options[0]) }));
  s.addEventListener("change", () => {
    setField(design, cmd, key, s.value);
    commit();
  });
  return s;
}

// ---------- parameters ----------
let uid = 0;
// label + control, linked by id so screen readers announce the label
function field(label, control) {
  control.id ||= `f${++uid}`;
  return el("div", { className: "row" }, el("label", { htmlFor: control.id, textContent: label }), control);
}
// number field with the language's own range for this option
function numField(label, cmd, obj, key, step) {
  const [, min, max] = SCHEMA[cmd][key];
  const expr = cmd in LISTS ? obj.exprs?.[key] : design.exprs[`${cmd}.${key}`];
  const i = el("input", { type: "number", min, max, step, value: obj[key], ariaLabel: label });
  i.dataset.key = `${cmd}.${key}`;
  if (expr) i.title = `Set by ${expr}; typing a number replaces the expression`;
  i.addEventListener("change", () => {
    const v = +i.value;
    if (!(v >= min && v <= max) || (SCHEMA[cmd][key][0] === "int" && !Number.isInteger(v))) {
      i.value = obj[key];
      return say(`${label} must be ${SCHEMA[cmd][key][0] === "int" ? "a whole number " : ""}between ${min} and ${max}.`);
    }
    setField(design, cmd, key, v);
    commit();
  });
  return field(expr ? `${label} ƒ` : label, i);
}
function selField(label, cmd, obj, key, options, labelOf = (o) => o) {
  const s = el("select", { ariaLabel: label });
  s.dataset.key = `${cmd}.${key}`;
  for (const o of options) s.append(el("option", { value: o, textContent: labelOf(o), selected: o === (obj[key] ?? options[0]) }));
  s.addEventListener("change", () => {
    setField(design, cmd, key, s.value);
    commit();
  });
  return field(label, s);
}
function renderParams() {
  const focused = document.activeElement?.dataset?.key;
  const root = $("params");
  root.replaceChildren();

  const name = el("input", { type: "text", value: design.name, ariaLabel: "Design name" });
  name.dataset.key = "design.name";
  name.addEventListener("change", () => {
    design.name = name.value.trim() || "Untitled ring";
    commit();
  });
  root.append(field("Design name", name));

  // ring size: a number plus a sizing system, or a diameter
  if (design.ring.diameter !== undefined) {
    root.append(numField("Inside diameter (mm)", "ring", design.ring, "diameter", 0.01));
    const back = el("button", { type: "button", textContent: "Use a ring size instead" });
    back.addEventListener("click", () => {
      delete design.ring.diameter;
      delete design.exprs["ring.diameter"];
      design.ring = { size: "US7", ...design.ring };
      commit();
    });
    root.append(el("div", { className: "row" }, el("span"), back));
  } else {
    const m = /^([A-Z]+)(.+)$/.exec(design.ring.size);
    const sys = el("select", { ariaLabel: "Sizing system" });
    for (const o of ["US", "EU", "DE", "IT", "JP"]) sys.append(el("option", { value: o, textContent: o, selected: o === m[1] }));
    const num = el("input", { type: "number", step: 0.25, value: m[2], ariaLabel: "Ring size" });
    num.dataset.key = "ring.size";
    sys.dataset.key = "ring.system";
    // switching system converts the size, keeping the same finger diameter
    sys.addEventListener("change", () => {
      setField(design, "ring", "size", sizeFromDiameter(sys.value, parseSize(design.ring.size).innerDiameter));
      commit();
    });
    const apply = () => {
      const test = parse(`design "x"\nring size=${sys.value}${num.value}`);
      if (test.errors.length) {
        num.value = m[2];
        sys.value = m[1];
        return say(test.errors[0].message.replace(/^size /, "Ring size "));
      }
      setField(design, "ring", "size", test.design.ring.size);
      commit();
    };
    num.addEventListener("change", apply);
    num.id = `f${++uid}`;
    root.append(el("div", { className: "row" }, el("label", { htmlFor: num.id, textContent: "Ring size" }), el("span", { className: "num" }, sys, num)));
  }
  root.append(
    selField("Metal", "ring", design.ring, "metal", Object.keys(METALS), (k) => METALS[k].label),
    ...(design.shank.profile !== "none" ? [numField("Band width (mm)", "shank", design.shank, "width", 0.1), numField("Band thickness (mm)", "shank", design.shank, "thickness", 0.1)] : []),
    selField("Band profile", "shank", design.shank, "profile", PROFILES, (o) => (o === "none" ? "none (sculpt is the ring)" : o)),
    selField("Centre setting", "stone", design.stone, "setting", SETTINGS, (o) => (o === "none" ? "none (plain band)" : o)),
  );
  if (design.stone.setting !== "none") {
    root.append(selField("Cut", "stone", design.stone, "cut", Object.keys(CUTS)), numField("Stone width (mm)", "stone", design.stone, "dia", 0.1));
    if (design.stone.setting === "prong") {
      root.append(numField("Prongs", "stone", design.stone, "prongs", 1), selField("Prong tips", "stone", design.stone, "tip", TIPS));
    }
    const halo = el("input", { type: "checkbox", checked: !!design.halo, ariaLabel: "Halo" });
    halo.dataset.key = "halo.on";
    halo.addEventListener("change", () => {
      design.halo = halo.checked ? { dia: 1.2, gap: 0.1 } : null;
      commit();
    });
    root.append(field("Halo", halo));
    if (design.halo) root.append(selField("Halo kind", "halo", design.halo, "kind", HALO_KINDS), numField("Halo stone (mm)", "halo", design.halo, "dia", 0.1));
  }
  // brushed pavé settings only matter once something is painted
  if (design.paint.length) {
    const auto = el("input", { type: "checkbox", checked: design.pave.dia === "auto", ariaLabel: "Brushed pavé auto size" });
    auto.dataset.key = "pave.auto";
    auto.addEventListener("change", () => {
      setField(design, "pave", "dia", auto.checked ? "auto" : 1.3);
      commit();
    });
    root.append(field("Brushed pavé auto size", auto));
    if (design.pave.dia !== "auto") root.append(numField("Brushed pavé stone (mm)", "pave", design.pave, "dia", 0.1));
  }
  root.append(numField("Minimum wall (mm)", "rule", design.rule, "min_wall", 0.05));
  if (design.vars.length) root.append(el("div", { className: "row" }, el("span", { textContent: "Variables" }), el("span", { textContent: design.vars.map((v) => `${v.name}=${v.raw}`).join(", ") })));
  if (focused) root.querySelector(`[data-key="${focused}"]`)?.focus();
}

// ---------- objects tree ----------
function objectEntries() {
  const n = (cmd) => textarea.value.split("\n").findIndex((l) => new RegExp(`^\\s*${cmd}\\b`).test(l)) + 1;
  const byId = (cmd, id) => textarea.value.split("\n").findIndex((l) => new RegExp(`^\\s*${cmd}\\b.*\\bid=${id}\\b`).test(l)) + 1;
  const weight = (obj) => lastReport?.parts.filter((p) => p.obj === obj || p.obj?.startsWith(`${obj}~`)).reduce((a, p) => a + p.weightG, 0) || 0;
  const count = (obj) => model?.stones.filter((s) => s.obj === obj || s.obj?.startsWith(`${obj}~`)).length || 0;
  const out = [
    { obj: "shank", label: `Shank · ${design.shank.profile} ${design.shank.width}×${design.shank.thickness} mm`, line: n("shank") },
    ...(design.stone.setting !== "none" ? [{ obj: "stone", label: `Centre · ${design.stone.cut} ${design.stone.dia} mm, ${design.stone.setting}`, line: n("stone") }] : []),
    ...(design.halo ? [{ obj: "halo", label: `Halo · ${design.halo.kind || "single"}, ${count("halo")} stones`, line: n("halo") }] : []),
  ];
  for (const [cmd, key] of Object.entries(LISTS)) {
    for (const o of design[key]) {
      out.push({ obj: o.id, cmd, label: `${cmd} ${o.id} · ${count(o.id)} stones${o.mirror === "yes" ? " (mirrored)" : ""}`, line: byId(cmd, o.id), removable: true });
    }
  }
  if (design.paint.length) out.push({ obj: "pave", label: `Brushed pavé · ${design.paint.length} strokes, ${count("pave")} stones`, line: n("paint"), clearable: true });
  return out.map((e) => ({ ...e, weight: weight(e.obj) }));
}
function renderObjects() {
  const root = $("objects");
  root.replaceChildren(
    ...objectEntries().map((e) => {
      const li = el("li", { className: e.obj === selected ? "sel" : "" });
      const pick = el("button", { type: "button", className: "name", textContent: e.label });
      pick.title = "Highlight in the viewport and select its script line";
      pick.addEventListener("click", () => {
        selected = selected === e.obj ? null : e.obj;
        viewer.setHighlight(selected);
        renderObjects();
        if (selected && e.line > 0) {
          const lines = textarea.value.split("\n");
          const start = lines.slice(0, e.line - 1).reduce((a, l) => a + l.length + 1, 0);
          textarea.setSelectionRange(start, start + lines[e.line - 1].length);
        }
      });
      li.append(pick);
      if (e.weight) li.append(el("span", { className: "muted", textContent: `${weightIn(e.weight, prefs.weight).toFixed(2)} ${WEIGHT[prefs.weight].label}` }));
      if (e.removable || e.clearable) {
        const del = el("button", { type: "button", textContent: "Remove", ariaLabel: `Remove ${e.obj}` });
        del.addEventListener("click", () => {
          if (e.clearable) design.paint = [];
          else design[LISTS[e.cmd]] = design[LISTS[e.cmd]].filter((o) => o.id !== e.obj);
          if (selected === e.obj) selected = null;
          viewer.setHighlight(selected);
          commit();
        });
        li.append(del);
      }
      return li;
    }),
  );
}
function showTab(which) {
  $("tab-script").setAttribute("aria-selected", String(which === "script"));
  $("tab-objects").setAttribute("aria-selected", String(which === "objects"));
  $("script-view").hidden = which !== "script";
  $("objects-view").hidden = which !== "objects";
}

// ---------- tech sheet (sidebar summary) ----------
function unitSelect(group, table) {
  const s = el("select", { ariaLabel: `${group} unit` });
  for (const k of Object.keys(table)) s.append(el("option", { value: k, textContent: table[k].label, selected: prefs[group] === k }));
  s.addEventListener("change", () => {
    prefs[group] = s.value;
    store.set(JSON.stringify(prefs), "jewelscript.units");
    if (lastReport) renderSheet(lastReport), renderObjects();
  });
  return s;
}
function renderSheet(r) {
  const fx = (n, dg = 2) => n.toFixed(dg);
  const gd = GEM_WEIGHT[prefs.gem].digits;
  const table = el("table", {},
    el("tr", {}, el("th", { textContent: "Stone" }), el("th", { className: "n", textContent: "mm" }), el("th", { className: "n", textContent: "qty" }), el("th", { className: "n", textContent: GEM_WEIGHT[prefs.gem].label })),
    ...r.stones.map((s) => el("tr", {}, el("td", { textContent: `${s.role} ${s.cut}` }), el("td", { className: "n", textContent: fx(s.dia, 2) }), el("td", { className: "n", textContent: s.count }), el("td", { className: "n", textContent: fx(gemIn(s.total, prefs.gem), gd) }))),
  );
  $("sheet").replaceChildren(
    el("p", { className: "stale-note", textContent: "Stale: the script has errors, so this is the last valid design." }),
    row("Weight unit", unitSelect("weight", WEIGHT)),
    row("Gem unit", unitSelect("gem", GEM_WEIGHT)),
    row("Length unit", unitSelect("length", LENGTH)),
    row("Metal", el("span", { textContent: `${r.metal.name} (${fx(r.metal.density, 2)} g/cm³)` })),
    row(r.metal.exact ? "Weight (exact)" : "Weight (estimate)", el("strong", { textContent: `${fx(weightIn(r.metal.weightG, prefs.weight), prefs.weight === "g" ? 2 : 3)} ${WEIGHT[prefs.weight].label}` })),
    row("Inside diameter", el("span", { textContent: `${fx(lengthIn(r.innerDiameter, prefs.length), prefs.length === "in" ? 3 : 2)} ${prefs.length}` })),
    ...(r.minWall.shank != null ? [row("Thinnest band wall", el("span", { textContent: `${fx(lengthIn(r.minWall.shank, prefs.length), prefs.length === "in" ? 3 : 2)} ${prefs.length}` }))] : []),
    ...Object.entries(r.sculpts || {}).filter(([, i]) => i.minWall).map(([id, i]) => row(`Thinnest wall, ${id}`, el("span", { textContent: `${fx(lengthIn(i.minWall.mm, prefs.length), prefs.length === "in" ? 3 : 2)} ${prefs.length}` }))),
    ...(r.centre ? [row("Centre stone", el("span", { textContent: `${r.centre.cut} ${fx(r.centre.dia, 1)}×${fx(r.centre.length, 1)} mm` }))] : []),
    row("Stones", el("span", { textContent: `${r.stoneCount} · ${fx(gemIn(r.totalCt, prefs.gem), gd)} ${GEM_WEIGHT[prefs.gem].label} est.` })),
    ...(r.paveDia && design.paint.length ? [row("Brushed pavé size", el("span", { textContent: `${fx(r.paveDia, 1)} mm${design.pave.dia === "auto" ? " (auto)" : ""}` }))] : []),
    ...(r.shrink ? [row("Cast shrinkage", el("span", { textContent: `+${r.shrink}% on export` }))] : []),
    table,
    el("h2", { textContent: "Checks" }),
    ...r.checks.map((c) => el("div", { className: `check ${c.level}`, textContent: c.text })),
    el("p", { className: "note", id: "exact-status" }),
    el("p", { className: "note", textContent: r.metal.exact ? "Exact: all metal unioned into one solid with every stone seat cut. Typical alloy densities; carats are diamond estimates." : "Estimate until the exact solid is ready. Typical alloy densities; carats are diamond estimates." }),
  );
}

// ---------- downloads ----------
function download(blob, name) {
  const a = el("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const slug = () => design.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ring";

// ---------- export dialog ----------
function openExport() {
  if (!needValid()) return;
  const part = $("ex-part");
  part.replaceChildren(el("option", { value: "", textContent: "Whole piece" }), ...objectEntries().map((e) => el("option", { value: e.obj, textContent: e.label })));
  $("ex-shrink").value = design.rule.shrink ?? 0;
  updateExportForm();
  $("export-dialog").showModal();
}
function updateExportForm() {
  const f = $("ex-format").value;
  $("ex-run").hidden = f !== "sizerun";
  $("ex-part").disabled = !["stl", "stl-stones"].includes(f);
  $("ex-note").textContent = {
    stl: "Binary STL of the metal in millimetres.",
    "stl-stones": "Binary STL of the stones only.",
    "3mf": "3MF package with metal and stones as separate objects, units in millimetres.",
    glb: "GLB with metal and stones, for web viewers and AR.",
    obj: "OBJ with metal and stones, for rendering.",
    bundle: "Zip with design.jws (editable source), metal.stl, stones.stl and model.3mf.",
    sizerun: "Zip with one metal STL per finger size; everything else stays the same.",
  }[f];
}
async function runExport() {
  const shrink = +$("ex-shrink").value || 0;
  if (!(shrink >= 0 && shrink <= 5)) {
    say("Shrinkage compensation must be between 0 and 5 %.");
    return false;
  }
  if (shrink !== (design.rule.shrink ?? 0)) {
    setField(design, "rule", "shrink", shrink);
    commit();
  }
  const q = $("ex-quality").value;
  let m = build(design, { quality: q });
  // whole-piece metal comes from the exact solid (one watertight shell, seats cut)
  if (["stl", "3mf", "glb", "obj", "bundle"].includes($("ex-format").value) && !$("ex-part").value) {
    say("Waiting for the exact solid…");
    if (q === "standard" && (await ensureExact()) && model?.solidGeometry) m = Object.assign(m, { solidGeometry: model.solidGeometry });
  }
  const f = $("ex-format").value;
  const part = $("ex-part").value || undefined;
  const suffix = part ? `-${part}` : "";
  try {
    if (f === "stl") download(new Blob([stlBytes(m, "metal", { obj: part })], { type: "model/stl" }), `${slug()}${suffix}-metal.stl`);
    else if (f === "stl-stones") download(new Blob([stlBytes(m, "stones", { obj: part })], { type: "model/stl" }), `${slug()}${suffix}-stones.stl`);
    else if (f === "3mf") download(viewer.export3mf(m), `${slug()}.3mf`);
    else if (f === "glb") download(await viewer.exportGlb(m), `${slug()}.glb`);
    else if (f === "obj") download(viewer.exportObj(m), `${slug()}.obj`);
    else if (f === "bundle") download(new Blob([bundle(design, m, textarea.value)], { type: "application/zip" }), `${slug()}-bundle.zip`);
    else if (f === "sizerun") {
      const from = +$("ex-from").value, to = +$("ex-to").value, step = +$("ex-step").value;
      download(new Blob([sizeRun(design, sizeRange($("ex-sys").value, from, to, step), q)], { type: "application/zip" }), `${slug()}-size-run.zip`);
    }
    say(`Exported ${f.toUpperCase()}.`);
  } catch (e) {
    say(`Export failed: ${e.message}`);
  }
}

// ---------- tech sheet dialog ----------
let logo = null;
function sheetHtml() {
  const views = [...document.querySelectorAll('#sheet-dialog input[name="view"]:checked')].map((c) => c.value);
  const mode = $("ts-mode").value;
  const rendered = views.map((v) => ({ name: v[0].toUpperCase() + v.slice(1), ...viewer.renderView(model, v, { mode }) }));
  const density = parseFloat($("ts-density").value);
  return techSheetHtml({
    design, report: lastReport, views: rendered,
    gemMap: $("ts-gemmap").checked && model.stones.length ? gemMapSvg(model, lastReport) : "",
    units: prefs, notes: $("ts-notes").value, logo,
    densityOverride: density >= 1 && density <= 25 ? density : null,
  });
}
function previewSheet() {
  $("ts-frame").srcdoc = sheetHtml();
}

// ---------- gallery ----------
function renderGallery() {
  const items = search($("gallery-search").value, $("gallery-kind").value);
  $("gallery-list").replaceChildren(
    ...(items.length ? items : [null]).map((it) => {
      if (!it) return el("li", { className: "muted", textContent: "Nothing matches." });
      const b = el("button", { type: "button" }, el("strong", { textContent: it.name }), el("span", { className: "muted", textContent: `${it.kind} · ${it.keywords}` }));
      b.addEventListener("click", () => {
        if (it.kind === "design") {
          $("gallery-dialog").close();
          return replaceText(it.text, `Opened ${it.name}.`);
        } else {
          if (!needValid()) return;
          const res = insertComponent(it.text);
          if (res.error) return say(`Cannot insert: ${res.error}`);
          textarea.value = res.text;
          if (res.note) setTimeout(() => say(res.note), 0);
        }
        rebuild();
        $("gallery-dialog").close();
        say(`${it.kind === "design" ? "Opened" : "Inserted"} ${it.name}.`);
      });
      return el("li", {}, b);
    }),
  );
}

// ---------- sculpt import ----------
let pendingImport = null;
function openSculptDialog(file, ref) {
  pendingImport = { file, ref };
  $("sc-file").textContent = ref.message;
  $("sc-fit").checked = true;
  $("sc-whole").checked = true;
  $("sculpt-dialog").showModal();
}
async function addSculpt() {
  const { file, ref } = pendingImport;
  if (!needValid()) return;
  const { bytes, ext } = ref;
  const id = await assetId(bytes);
  await putAsset(id, { name: file.name, ext, bytes });
  const num = (elId) => +$(elId).value || 0;
  const sc = { id: nextId("sculpt"), src: id, fit: $("sc-fit").checked ? "ring" : "none", repair: $("sc-repair").value };
  if (ref.metres && sc.fit === "none") sc.scale = 1000; // glTF metres -> mm
  if (num("sc-close")) sc.close = num("sc-close");
  if (num("sc-smooth")) sc.smooth = num("sc-smooth");
  if (num("sc-hollow")) sc.hollow = num("sc-hollow");
  if ($("sc-sym").value !== "none") sc.symmetrize = $("sc-sym").value;
  design.sculpts.push(sc);
  if ($("sc-whole").checked) {
    setField(design, "shank", "profile", "none");
    setField(design, "stone", "setting", "none");
    design.halo = null;
  }
  commit();
  say(`Added sculpt ${sc.id}; preparing it (repair and fit can take a few seconds)…`);
}

// A component's lines merged into the script: a halo (or other single
// command) replaces the existing one; a clashing id gets a number added.
function insertComponent(componentText) {
  const base = current();
  let lines = componentText.split("\n");
  const notes = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\w+)\b(.*)$/.exec(lines[i].trim());
    if (!m) continue;
    const [, cmd] = m;
    if (cmd in LISTS) {
      const idm = /\bid=([\w-]+)/.exec(lines[i]);
      const taken = new Set(Object.values(LISTS).flatMap((k) => base.design[k].map((o) => o.id)));
      if (idm && taken.has(idm[1])) {
        let n = 2;
        while (taken.has(`${idm[1]}${n}`)) n++;
        lines[i] = lines[i].replace(`id=${idm[1]}`, `id=${idm[1]}${n}`);
        notes.push(`named it ${idm[1]}${n}`);
      }
    }
  }
  let text = textarea.value.replace(/\s*$/, "");
  for (const l of lines) {
    const cmd = l.trim().split(/\s+/)[0];
    const existing = text.split("\n").findIndex((x) => x.trim().split(/\s+/)[0] === cmd);
    if (["halo", "pave", "rule"].includes(cmd) && existing >= 0) {
      const all = text.split("\n");
      all[existing] = l;
      text = all.join("\n");
      notes.push(`replaced the existing ${cmd}`);
    } else text += `\n${l}`;
  }
  text += "\n";
  const p = parse(text);
  if (p.errors.length) return { error: p.errors[0].message };
  return { text, note: notes.length ? `Inserted; ${notes.join(", ")}.` : "" };
}

// ---------- assistant ----------
function runAssistant(apply) {
  const text = $("assistant-input").value.trim();
  const out = $("assistant-out");
  if (!text) return out.replaceChildren();
  if (!current().ok) return out.replaceChildren(el("p", { className: "warn-note", textContent: "The script has errors: fix them (or Undo) before using the assistant." }));
  const r = interpret(text, design);
  out.replaceChildren(
    el("p", { textContent: r.changes.length ? `Changes: ${r.changes.join("; ")}.` : "No changes recognised." }),
    ...r.notes.map((n) => el("p", { className: "warn-note", textContent: n })),
    ...(r.ignored.length ? [el("p", { className: "muted", textContent: `Not understood: ${r.ignored.join(", ")}` })] : []),
  );
  if (apply && r.changes.length) {
    design = r.design;
    commit();
    viewer.fit();
    out.append(el("p", { className: "muted", textContent: "Applied. Undo reverts it." }));
  }
}

// ---------- command palette ----------
function commands() {
  const list = [
    { label: "Open gallery", run: () => ($("gallery-dialog").showModal(), renderGallery()) },
    { label: "Open assistant", run: () => $("assistant-dialog").showModal() },
    { label: "Export…", run: openExport },
    { label: "Tech sheet…", run: () => openSheet() },
    { label: "Undo", run: undo },
    { label: "Redo", run: redo },
    { label: "Toggle theme", run: toggleTheme },
    { label: "Fit view", run: () => viewer.fit() },
    { label: "Layout: 1 view", run: () => setLayout(1) },
    { label: "Layout: 4 views", run: () => setLayout(4) },
    { label: "Clear band pavé (brush, strokes, regions)", run: () => $("clear-paint").click() },
    { label: "Remove reference mesh", run: () => (viewer.setReference(null), say("Reference removed.")) },
    { label: "Tool: surface (paint on a sculpt)", run: () => setTool("surface") },
    { label: "Show objects", run: () => showTab("objects") },
    { label: "Show script", run: () => showTab("script") },
    ...["iso", "top", "front", "right"].map((v) => ({ label: `View: ${v}`, run: () => viewer.setView(v) })),
    ...Object.keys(TOOL_HINTS).map((t) => ({ label: `Tool: ${t}`, run: () => setTool(t) })),
    ...["shaded", "translucent", "edges", "heat"].map((m) => ({ label: `Display: ${m === "heat" ? "wall thickness" : m}`, run: () => setDisplay(m) })),
    ...DESIGNS.map((d) => ({ label: `Open design: ${d.name}`, run: () => replaceText(d.text, `Opened ${d.name}.`) })),
    ...COMPONENTS.map((c) => ({ label: `Insert component: ${c.name}`, run: () => {
      const next = `${textarea.value.replace(/\s*$/, "")}\n${c.text}\n`;
      if (parse(next).errors.length) return say("Cannot insert that component here (id already used?).");
      textarea.value = next;
      rebuild();
    } })),
  ];
  return list;
}
let paletteItems = [];
let paletteIndex = 0;
function renderPalette() {
  const q = $("palette-input").value.toLowerCase().split(/\s+/).filter(Boolean);
  paletteItems = commands().filter((c) => q.every((w) => c.label.toLowerCase().includes(w))).slice(0, 12);
  paletteIndex = Math.min(paletteIndex, Math.max(0, paletteItems.length - 1));
  $("palette-list").replaceChildren(
    ...paletteItems.map((c, i) => {
      const li = el("li", { role: "option", className: i === paletteIndex ? "active" : "", textContent: c.label, ariaSelected: String(i === paletteIndex) });
      li.addEventListener("click", () => runPalette(i));
      return li;
    }),
  );
}
function runPalette(i) {
  const c = paletteItems[i];
  $("palette-dialog").close();
  c?.run();
}
function openPalette() {
  $("palette-input").value = "";
  paletteIndex = 0;
  renderPalette();
  $("palette-dialog").showModal();
  $("palette-input").focus();
}

// ---------- view controls ----------
function setLayout(n) {
  viewer.setLayout(n);
  $("layout1").setAttribute("aria-pressed", String(n === 1));
  $("layout4").setAttribute("aria-pressed", String(n === 4));
}
function setDisplay(m) {
  $("display").value = m;
  viewer.setMode(m);
  $("heat-legend").hidden = m !== "heat";
}
function toggleTheme() {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  store.set(root.dataset.theme, "jewelscript.theme");
}
function openSheet() {
  if (!needValid()) return;
  $("sheet-dialog").showModal();
  previewSheet();
}

// ---------- wiring ----------
textarea.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(rebuild, 250);
});
$("tab-script").addEventListener("click", () => showTab("script"));
$("tab-objects").addEventListener("click", () => showTab("objects"));
for (const b of document.querySelectorAll("[data-tool]")) b.addEventListener("click", () => setTool(b.dataset.tool));
for (const b of document.querySelectorAll("[data-view]")) b.addEventListener("click", () => viewer.setView(b.dataset.view));
$("fit").addEventListener("click", () => viewer.fit());
$("layout1").addEventListener("click", () => setLayout(1));
$("layout4").addEventListener("click", () => setLayout(4));
$("display").addEventListener("change", (e) => setDisplay(e.target.value));
$("brush").addEventListener("input", (e) => viewer.setBrush(+e.target.value));
$("wand-span").addEventListener("change", (e) => viewer.setWandSpan(Math.max(1, Math.min(40, +e.target.value || 6))));
$("snap").addEventListener("change", (e) => viewer.setSnap(+e.target.value));
$("clear-paint").addEventListener("click", () => {
  if (!needValid()) return;
  design.paint = [];
  design.strokes = [];
  design.regions = [];
  commit();
  say("Cleared brushed pavé, strokes and regions. Undo brings them back.");
});
$("undo").addEventListener("click", undo);
$("redo").addEventListener("click", redo);
$("theme").addEventListener("click", toggleTheme);
$("open-gallery").addEventListener("click", () => {
  renderGallery();
  $("gallery-dialog").showModal();
});
$("gallery-search").addEventListener("input", renderGallery);
$("gallery-kind").addEventListener("change", renderGallery);
$("open-assistant").addEventListener("click", () => $("assistant-dialog").showModal());
$("assistant-input").addEventListener("input", () => runAssistant(false));
$("assistant-apply").addEventListener("click", (e) => {
  e.preventDefault();
  runAssistant(true);
});
$("open-export").addEventListener("click", openExport);
$("sc-add").addEventListener("click", async (e) => {
  e.preventDefault();
  $("sculpt-dialog").close();
  try {
    await addSculpt();
  } catch (err) {
    say(`Import failed: ${err.message}`);
  }
});
$("sc-ref").addEventListener("click", (e) => {
  e.preventDefault();
  $("sculpt-dialog").close();
  viewer.setReference(pendingImport.ref.object);
  say(`${pendingImport.ref.message} Shown for comparison only (remove it from the command palette).`);
});
$("ex-format").addEventListener("change", updateExportForm);
$("ex-go").addEventListener("click", async (e) => {
  e.preventDefault();
  if ((await runExport()) !== false) $("export-dialog").close();
});
$("open-sheet").addEventListener("click", openSheet);
$("ts-preview").addEventListener("click", (e) => (e.preventDefault(), previewSheet()));
$("ts-download").addEventListener("click", (e) => {
  e.preventDefault();
  download(new Blob([sheetHtml()], { type: "text/html" }), `${slug()}-tech-sheet.html`);
});
$("ts-print").addEventListener("click", (e) => {
  e.preventDefault();
  previewSheet();
  $("ts-frame").addEventListener("load", () => $("ts-frame").contentWindow.print(), { once: true });
});
$("ts-logo").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return (logo = null);
  const r = new FileReader();
  r.onload = () => ((logo = r.result), previewSheet());
  r.readAsDataURL(f);
});
$("open-palette").addEventListener("click", openPalette);
$("palette-input").addEventListener("input", () => ((paletteIndex = 0), renderPalette()));
$("palette-input").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") paletteIndex = Math.min(paletteItems.length - 1, paletteIndex + 1), renderPalette(), e.preventDefault();
  else if (e.key === "ArrowUp") paletteIndex = Math.max(0, paletteIndex - 1), renderPalette(), e.preventDefault();
  else if (e.key === "Enter") e.preventDefault(), runPalette(paletteIndex);
});
$("import").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const r = await importFile(f, design);
    if (r.kind === "script") {
      replaceText(r.text, `Opened ${f.name}.`);
    } else if (r.kind === "reference") {
      // a mesh: ask whether it is part of the design (a sculpt) or a reference
      openSculptDialog(f, r);
    } else if (r.kind === "region") {
      if (!needValid()) return;
      design.regions.push({ id: nextId("svg"), ...r.region });
      commit();
      say(r.message);
    }
  } catch (err) {
    say(`Import failed: ${err.message}`);
  }
});
document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openPalette();
  } else if (mod && e.key.toLowerCase() === "z" && document.activeElement !== textarea) {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  } else if (mod && e.key.toLowerCase() === "y" && document.activeElement !== textarea) {
    e.preventDefault();
    redo();
  } else if (e.key === "Escape" && document.activeElement?.tagName !== "TEXTAREA" && !document.querySelector("dialog[open]")) {
    setTool("orbit");
  }
});

const theme = store.get("jewelscript.theme");
if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;

// Reopen whatever was in the editor, even with errors; the viewport then shows
// the last valid design until the errors are fixed.
textarea.value = store.get(DRAFT) || store.get() || serialize(defaultDesign());
history.past = [];
history.last = null;
try {
  const h = JSON.parse(store.get(HISTORY) || "null");
  if (h && Array.isArray(h.past) && h.past.every((x) => typeof x === "string")) {
    history.past = h.past;
    history.last = h.last === textarea.value ? h.last : textarea.value;
    if (h.last !== textarea.value && typeof h.last === "string") history.past.push(h.last);
  }
} catch {}
history.last ??= textarea.value;
rebuild({ record: false });
window.__cad = { viewer, ensureExact, get design() { return design; }, get model() { return model; }, get report() { return lastReport; } };
