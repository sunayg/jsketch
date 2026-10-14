// JewelScript: a short, line-based design language (millimetres).
//
//   design "Solitaire"
//   var band=1.8                       # variables, used as {band} or {band*2}
//   ring size=US7 metal=18k-yellow     # or diameter={17.35} instead of size
//   shank width=3 thickness={band} profile=comfort
//   stone cut=round dia=6.5 setting=prong prongs=4
//   halo dia=1.2 gap=0.1
//   pave dia=auto min=0.9 max=2 gap=0.15
//   paint s=0 w=0 r=2
//   rule min_wall=0.8 shrink=0
import { parseSize, sizeInRange, formatSize } from "./sizes.js";
import { CUTS } from "./gems.js";
import { evalExpr } from "./expr.js";

// density in g/cm3: typical values for the alloy, not a certified figure
export const METALS = {
  "9k-yellow": { label: "9k yellow gold", density: 11.2, color: "#dcb544" },
  "10k-yellow": { label: "10k yellow gold", density: 11.6, color: "#dfb746" },
  "14k-yellow": { label: "14k yellow gold", density: 13.1, color: "#e0b947" },
  "14k-white": { label: "14k white gold", density: 12.9, color: "#d9dce1" },
  "14k-rose": { label: "14k rose gold", density: 13.0, color: "#e3a68f" },
  "18k-yellow": { label: "18k yellow gold", density: 15.5, color: "#e3b94c" },
  "18k-white": { label: "18k white gold", density: 15.6, color: "#dadde2" },
  "18k-rose": { label: "18k rose gold", density: 15.0, color: "#e5a58f" },
  "22k-yellow": { label: "22k yellow gold", density: 17.8, color: "#e6bc3e" },
  platinum: { label: "Platinum 950", density: 21.4, color: "#cfd3d9" },
  palladium: { label: "Palladium 950", density: 11.9, color: "#c5c8cc" },
  "silver-925": { label: "Silver 925", density: 10.36, color: "#d8dadd" },
  titanium: { label: "Titanium", density: 4.5, color: "#a9adb3" },
  stainless: { label: "Stainless steel", density: 7.9, color: "#b8bcc2" },
  brass: { label: "Brass", density: 8.5, color: "#c9a24a" },
  bronze: { label: "Bronze", density: 8.8, color: "#b0794a" },
  copper: { label: "Copper", density: 8.96, color: "#c8744d" },
};
export const PROFILES = ["flat", "comfort", "domed", "none"]; // none: no band (e.g. the sculpt is the whole ring)
export const SETTINGS = ["prong", "bezel", "illusion", "none"]; // none: no centre stone
export const TIPS = ["round", "pointed", "flat", "claw"];
export const HALO_KINDS = ["single", "double", "hidden"];
const YESNO = ["yes", "no"];
// commands that can appear many times, each with a unique id
export const LISTS = { accent: "accents", stroke: "strokes", region: "regions", sculpt: "sculpts", surfpave: "surfpaves" };

// command -> { key: [type, min, max] | [enum values] }
export const SCHEMA = {
  design: {},
  var: {},
  ring: { size: ["size"], diameter: ["num", 10, 30], metal: [Object.keys(METALS)], density: ["num", 1, 25] },
  shank: { width: ["num", 1, 12], thickness: ["num", 0.4, 5], profile: [PROFILES] },
  stone: { cut: [Object.keys(CUTS)], dia: ["num", 1, 15], setting: [SETTINGS], prongs: ["int", 3, 8], tip: [TIPS] },
  halo: { dia: ["num", 0.8, 3], gap: ["num", 0, 1], kind: [HALO_KINDS] },
  pave: { dia: ["numauto", 0.8, 3], gap: ["num", 0, 1], min: ["num", 0.8, 3], max: ["num", 0.8, 3], bead: ["num", 0, 0.8] },
  accent: {
    id: ["id"], cut: [Object.keys(CUTS)], dia: ["num", 1, 8], s: ["num", -200, 200], w: ["num", -10, 10],
    setting: [["bezel", "prong", "flush"]], prongs: ["int", 3, 6], tip: [TIPS], mirror: [YESNO],
  },
  stroke: {
    id: ["id"], pts: ["pts"], dia: ["num", 0.8, 3], count: ["int", 1, 300], gap: ["num", 0, 1],
    setting: [["bead", "channel", "none"]], bead: ["num", 0.2, 0.8], mirror: [YESNO],
  },
  region: {
    id: ["id"], pts: ["pts"], dia: ["numauto", 0.8, 3], gap: ["num", 0, 1], min: ["num", 0.8, 3], max: ["num", 0.8, 3],
    setting: [["bead", "none"]], bead: ["num", 0.2, 0.8], mirror: [YESNO],
  },
  sculpt: {
    id: ["id"], src: ["src"], fit: [["ring", "none"]], scale: ["num", 0.0001, 10000],
    x: ["num", -100, 100], y: ["num", -100, 100], z: ["num", -100, 100],
    rx: ["num", -360, 360], ry: ["num", -360, 360], rz: ["num", -360, 360],
    repair: [["auto", "voxel", "none"]], voxel: ["num", 0.05, 0.5], close: ["int", 0, 10], smooth: ["int", 0, 5],
    keep: [["largest", "all"]], hollow: ["num", 0, 5], symmetrize: [["none", "x+", "x-"]], simplify: [YESNO],
  },
  // pavé brushed onto a sculpt's surface: dabs are 3D points (mm)
  surfpave: {
    id: ["id"], on: ["ref"], pts: ["pts3"], r: ["num", 0.3, 10], dia: ["numauto", 0.8, 3], min: ["num", 0.8, 3], max: ["num", 0.8, 3],
    gap: ["num", 0, 1], setting: [["bead", "none"]], bead: ["num", 0.2, 0.8], mirror: [YESNO],
  },
  paint: { s: ["num", -200, 200], w: ["num", -10, 10], r: ["num", 0.3, 10] },
  rule: { min_wall: ["num", 0, 3], shrink: ["num", 0, 5] },
};
const SINGLE = new Set(["design", "ring", "shank", "stone", "halo", "pave", "rule"]);

export const defaultDesign = () => ({
  name: "Untitled ring",
  vars: [],
  exprs: {},
  ring: { size: "US7", metal: "18k-yellow" },
  shank: { width: 3, thickness: 1.8, profile: "comfort" },
  stone: { cut: "round", dia: 6.5, setting: "prong", prongs: 4 },
  halo: null,
  accents: [],
  strokes: [],
  regions: [],
  sculpts: [],
  surfpaves: [],
  pave: { dia: 1.3, gap: 0.15, bead: 0.35 },
  paint: [],
  rule: { min_wall: 0.8, shrink: 0 },
});

const LIST_DEFAULTS = {
  accent: () => ({ cut: "round", dia: 2, s: 12, w: 0, setting: "bezel", mirror: "no" }),
  stroke: () => ({ dia: 1.3, gap: 0.15, setting: "bead", bead: 0.35, mirror: "no" }),
  region: () => ({ dia: 1.3, gap: 0.15, setting: "bead", bead: 0.35, mirror: "no" }),
  sculpt: () => ({ fit: "none", repair: "auto" }),
  surfpave: () => ({ r: 1.5, dia: 1.3, gap: 0.15, setting: "bead", bead: 0.35, mirror: "no" }),
};

// "s:w,s:w,…" -> [[s, w], …]
export const formatPts = (pts) => pts.map((p) => p.map(fmt).join(":")).join(",");
function parsePts(val) {
  const pts = [];
  for (const pair of val.split(",")) {
    const m = /^(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?)$/.exec(pair);
    if (!m) return null;
    pts.push([+m[1], +m[2]]);
  }
  return pts;
}

// Split a line into tokens; {…} groups may contain spaces.
const tokenize = (src) => src.match(/(?:[^\s{]|\{[^}]*\}|\{[^}]*$)+/g) || [];

// Drop a trailing "# comment", but not a # inside a quoted design name.
function splitComment(raw) {
  let q = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "\\" && q) i++;
    else if (c === '"') q = !q;
    else if (c === "#" && !q) return [raw.slice(0, i), raw.slice(i)];
  }
  return [raw, ""];
}
const stripComment = (raw) => splitComment(raw)[0];
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const escName = (n) => n.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export function parse(text) {
  const d = defaultDesign();
  d.paint = [];
  const ids = new Set();
  const errors = [];
  const seen = new Set();
  const lineOf = {};
  let nonEmpty = false;
  const values = {}; // variable name -> number
  const err = (line, message) => errors.push({ line, message });
  // where each variable is defined, to explain "used before defined"
  const varLines = {};
  text.split(/\r?\n/).forEach((raw, i) => {
    const m = /^\s*var\s+([A-Za-z_]\w*)\s*=/.exec(stripComment(raw));
    if (m && !(m[1] in varLines)) varLines[m[1]] = i + 1;
  });

  // numeric value: plain number, or {expr}; returns { n, raw } or an error string
  const number = (val) => {
    try {
      if (val.startsWith("{") && !val.endsWith("}")) return `has an unclosed "{" (write {expression})`;
      if (val.startsWith("{")) return { n: evalExpr(val.slice(1, -1), values), raw: val };
      if (!NUMBER.test(val)) return "must be a number";
      return { n: Number(val) };
    } catch (e) {
      const m = /Unknown variable "(\w+)"/.exec(e.message);
      if (m && varLines[m[1]]) return `uses "${m[1]}" before it is defined on line ${varLines[m[1]]}; move that var line above`;
      return e.message;
    }
  };

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const src = stripComment(raw).trim();
    if (!src) return;
    const nameMatch = /^design\s+"((?:[^"\\]|\\.)*)"\s*$/.exec(src);
    if (nameMatch) {
      d.name = nameMatch[1].replace(/\\(.)/g, "$1");
      nonEmpty = true;
      return;
    }
    nonEmpty = true;
    const [cmd, ...rest] = tokenize(src);

    if (cmd === "var") {
      const m = /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(rest.join(" "));
      if (!m || rest.length < 1) return err(line, "var needs name=value, e.g. var band=1.8");
      if (m[1] === "pi" || Object.hasOwn(values, m[1])) return err(line, `"${m[1]}" is already defined`);
      const r = number(m[2].trim());
      if (typeof r === "string") return err(line, `${m[1]} ${r}`);
      values[m[1]] = r.n;
      d.vars.push({ name: m[1], raw: r.raw ?? String(r.n) });
      return;
    }

    const spec = SCHEMA[cmd];
    if (!spec || cmd === "design") return err(line, cmd === "design" ? 'design needs a quoted name: design "My ring"' : `Unknown command "${cmd}"`);
    if (SINGLE.has(cmd) && seen.has(cmd)) return err(line, `"${cmd}" can only appear once`);
    seen.add(cmd);
    lineOf[cmd] = line;
    const isList = Object.hasOwn(LISTS, cmd);
    let reported = false;
    const obj = isList ? { id: undefined, ...LIST_DEFAULTS[cmd]() } : cmd === "halo" ? { dia: 1.2, gap: 0.1 } : { ...(d[cmd] && !Array.isArray(d[cmd]) ? d[cmd] : {}) };
    if (cmd === "paint") Object.assign(obj, { s: 0, w: 0, r: 2 });
    // where a field's {expr} text is kept: per item for lists, per design otherwise
    const setExpr = (key, raw) => {
      if (isList) {
        if (raw) (obj.exprs ||= {})[key] = raw;
        else if (obj.exprs) delete obj.exprs[key];
      } else if (raw) d.exprs[`${cmd}.${key}`] = raw;
      else delete d.exprs[`${cmd}.${key}`];
    };
    const given = new Set();
    for (const [ti, tok] of rest.entries()) {
      const eq = tok.indexOf("=");
      if (eq < 1) {
        const prev = rest[ti - 1] || "";
        err(line, prev.startsWith("size=") && NUMBER.test(tok) ? `write the size without a space, e.g. size=${prev.slice(5)}${tok}` : `Expected key=value, got "${tok}"`);
        continue;
      }
      const key = tok.slice(0, eq);
      if (given.has(key)) {
        err(line, `${key} is given twice`);
        continue;
      }
      given.add(key);
      const val = tok.slice(eq + 1);
      const rule = spec[key];
      if (!rule) {
        err(line, `Unknown option "${key}" for ${cmd}`);
        continue;
      }
      if (rule[0] === "num" || rule[0] === "numauto" || rule[0] === "int") {
        if (rule[0] === "numauto" && val === "auto") {
          obj[key] = "auto";
          setExpr(key, null);
          continue;
        }
        if (cmd === "paint" && val.startsWith("{")) {
          err(line, "paint values must be plain numbers");
          continue;
        }
        const r = number(val);
        if (typeof r === "string") err(line, `${key} ${r}`);
        else if (rule[0] === "int" && !Number.isInteger(r.n)) err(line, `${key} must be a whole number`);
        else if (r.n < rule[1] || r.n > rule[2]) err(line, `${key} must be between ${rule[1]} and ${rule[2]}`);
        else {
          obj[key] = r.n;
          setExpr(key, r.raw);
        }
      } else if (rule[0] === "id") {
        if (!/^[A-Za-z_][\w-]*$/.test(val)) (reported = true), err(line, `id "${val}" must start with a letter and use letters, digits, _ or -`);
        else if (ids.has(val)) (reported = true), err(line, `id "${val}" is already used`);
        else {
          ids.add(val);
          obj.id = val;
        }
      } else if (rule[0] === "pts3") {
        const pts = val.split(",").map((t) => t.split(":"));
        if (!pts.every((p) => p.length === 3 && p.every((v) => NUMBER.test(v)))) (reported = true), err(line, "pts must look like x:y:z,x:y:z (mm)");
        else if (pts.flat().some((v) => Math.abs(+v) > 100)) (reported = true), err(line, "pts out of range (within ±100 mm)");
        else obj.pts = pts.map((p) => p.map(Number));
      } else if (rule[0] === "ref") {
        if (!/^[A-Za-z_][\w-]*$/.test(val)) err(line, `on= must name a sculpt id`);
        else obj.on = val;
      } else if (rule[0] === "src") {
        // an asset id (16 hex digits) or a mesh file name next to the script
        if (!/^([0-9a-f]{16}|[\w./-]+\.(stl|obj|glb))$/i.test(val)) (reported = true), err(line, "src must be an asset id or a .stl, .obj or .glb file name");
        else obj.src = val;
      } else if (rule[0] === "pts") {
        const pts = parsePts(val);
        if (!pts) (reported = true), err(line, "pts must look like s:w,s:w (numbers in mm)");
        else if (pts.some(([a, b]) => Math.abs(a) > 200 || Math.abs(b) > 10)) (reported = true), err(line, "pts out of range (s within ±200, w within ±10)");
        else obj.pts = pts;
      } else if (rule[0] === "size") {
        const s = parseSize(val);
        if (!s) err(line, `size must look like US7, EU54, DE54, IT14 or JP13`);
        else if (!sizeInRange(s)) err(line, `${s.system} size out of range`);
        else obj[key] = formatSize(s.system, s.n);
      } else if (rule[0].includes(val)) obj[key] = val;
      else err(line, `${key} must be one of: ${rule[0].join(", ")}`);
    }
    if (cmd === "ring" && given.has("diameter")) {
      if (given.has("size")) err(line, "give either size= or diameter=, not both (diameter wins)");
      else delete obj.size; // a diameter replaces the default size
    }
    if (isList) {
      if (obj.id === undefined) return reported ? undefined : err(line, `${cmd} needs an id, e.g. ${cmd} id=${cmd}1`);
      if (cmd === "sculpt" && !obj.src) return reported ? undefined : err(line, "sculpt needs src= (import a mesh first)");
      if (cmd === "surfpave" && (!obj.on || !obj.pts?.length)) return reported ? undefined : err(line, "surfpave needs on=<sculpt id> and pts=x:y:z,…");
      const need = cmd === "region" ? 3 : cmd === "stroke" ? 2 : 0;
      if (need && (!obj.pts || obj.pts.length < need)) return reported ? undefined : err(line, `${cmd} needs pts with at least ${need} points`);
      d[LISTS[cmd]].push(obj);
    } else if (cmd === "paint") d.paint.push(obj);
    else d[cmd] = obj;
  });
  for (const sp of d.surfpaves) {
    if (!d.sculpts.some((sc) => sc.id === sp.on)) errors.push({ line: lineOf.surfpave ?? 1, message: `surfpave ${sp.id}: no sculpt with id ${sp.on}` });
  }
  if (!nonEmpty) errors.push({ line: 1, message: "The script is empty: start with a design line, or pick one from the gallery" });
  if (d.pave.min !== undefined && d.pave.max !== undefined && d.pave.min > d.pave.max) {
    errors.push({ line: lineOf.pave, message: "pave min must not exceed max" });
  }
  return { design: d, errors };
}

function fmt(v) {
  return typeof v === "number" ? String(Math.round(v * 1000) / 1000) : v;
}
const line = (cmd, obj, exprs = {}) =>
  `${cmd} ${Object.entries(obj)
    .filter(([k, v]) => k !== "exprs" && v !== undefined)
    .map(([k, v]) => `${k}=${k === "pts" ? formatPts(v) : obj.exprs?.[k] ?? exprs[`${cmd}.${k}`] ?? fmt(v)}`)
    .join(" ")}`;

// An edited field no longer follows its expression: drop it before serializing.
export const setField = (d, cmd, key, value) => {
  d[cmd][key] = value;
  delete d.exprs[`${cmd}.${key}`];
};

export function serialize(d) {
  const out = [`design "${escName(d.name)}"`];
  for (const v of d.vars) out.push(`var ${v.name}=${v.raw}`);
  out.push(line("ring", d.ring, d.exprs), line("shank", d.shank, d.exprs), line("stone", d.stone, d.exprs));
  if (d.halo) out.push(line("halo", d.halo, d.exprs));
  for (const [cmd, key] of Object.entries(LISTS)) for (const o of d[key]) out.push(line(cmd, o));
  out.push(line("pave", d.pave, d.exprs));
  for (const p of d.paint) out.push(line("paint", p));
  out.push(line("rule", d.rule, d.exprs));
  return out.join("\n") + "\n";
}

// Identity of a script line: one per command, per var name, per list id, per paint index.
function lineKey(line, counters) {
  const src = stripComment(line).trim();
  if (!src) return null;
  if (/^design\s/.test(src)) return "design";
  const [cmd, ...rest] = tokenize(src);
  if (cmd === "var") {
    const m = /^([A-Za-z_]\w*)/.exec(rest.join(" "));
    return m ? `var:${m[1]}` : null;
  }
  if (Object.hasOwn(LISTS, cmd)) {
    const id = rest.find((t) => t.startsWith("id="))?.slice(3);
    return id ? `${cmd}:${id}` : null;
  }
  if (cmd === "paint") return `paint:${(counters.paint = (counters.paint || 0) + 1)}`;
  return cmd;
}
const sameTokens = (a, b) => {
  const ta = tokenize(stripComment(a).trim()).sort().join(" ");
  const tb = tokenize(b.trim()).sort().join(" ");
  return ta === tb;
};

// Write a design back into existing script text, changing only the lines that
// changed: comments, blank lines, line order and untouched lines survive.
export function mergeText(oldText, d) {
  const fresh = serialize(d).trimEnd().split("\n");
  const fc = {};
  const freshKeys = fresh.map((l) => lineKey(l, fc));
  const index = new Map(freshKeys.map((k, i) => [k, i]));
  const out = []; // { text, idx } idx = position in fresh, or -1 for comments
  const used = new Set();
  const oc = {};
  for (const l of oldText.replace(/\n$/, "").split("\n")) {
    const k = lineKey(l, oc);
    if (k === null) {
      out.push({ text: l, idx: -1 });
      continue;
    }
    if (!index.has(k) || used.has(k)) continue; // removed (or a duplicate)
    used.add(k);
    const nl = fresh[index.get(k)];
    const [, comment] = splitComment(l);
    out.push({ text: sameTokens(l, nl) ? l : comment ? `${nl}  ${comment.trim()}` : nl, idx: index.get(k) });
  }
  // new lines go after the closest earlier line in canonical order
  freshKeys.forEach((k, i) => {
    if (used.has(k)) return;
    let at = -1;
    for (let j = 0; j < out.length; j++) if (out[j].idx >= 0 && out[j].idx < i) at = j;
    out.splice(at + 1, 0, { text: fresh[i], idx: i });
  });
  return out.map((o) => o.text).join("\n").replace(/\n*$/, "\n");
}

const fromText = (text) => () => parse(text).design;

export const TEMPLATES = {
  Solitaire: defaultDesign,
  "Halo ring": () => ({ ...defaultDesign(), name: "Halo ring", stone: { cut: "oval", dia: 5.5, setting: "prong", prongs: 6 }, halo: { dia: 1.2, gap: 0.1 }, ring: { size: "US6.5", metal: "18k-white" } }),
  "Pavé band": () => {
    const d = defaultDesign();
    d.name = "Pavé band";
    d.stone = { cut: "round", dia: 4, setting: "prong", prongs: 4 };
    d.shank = { width: 5, thickness: 1.9, profile: "comfort" };
    d.ring.metal = "platinum";
    // both shoulders, clear of the head
    for (const sign of [-1, 1]) for (let s = 12; s <= 34; s += 2) d.paint.push({ s: sign * s, w: 0, r: 2.4 });
    return d;
  },
  "Parametric halo": fromText(`design "Parametric halo"
var stone_d=6
var band=1.9
ring diameter={17.35} metal=18k-rose
shank width={stone_d/2} thickness={band} profile=comfort
stone cut=round dia={stone_d} setting=prong prongs=6
halo dia={stone_d/5} gap=0.1
pave dia=auto min=0.9 max=1.7 gap=0.15
rule min_wall=0.8 shrink=0
`),
};
