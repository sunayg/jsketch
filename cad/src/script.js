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
export const PROFILES = ["flat", "comfort", "domed"];
export const SETTINGS = ["prong", "bezel"];

// command -> { key: [type, min, max] | [enum values] }
const SCHEMA = {
  design: {},
  var: {},
  ring: { size: ["size"], diameter: ["num", 10, 30], metal: [Object.keys(METALS)], density: ["num", 1, 25] },
  shank: { width: ["num", 1, 12], thickness: ["num", 0.4, 5], profile: [PROFILES] },
  stone: { cut: [Object.keys(CUTS)], dia: ["num", 1, 15], setting: [SETTINGS], prongs: ["num", 3, 8] },
  halo: { dia: ["num", 0.8, 3], gap: ["num", 0, 1] },
  pave: { dia: ["numauto", 0.8, 3], gap: ["num", 0, 1], min: ["num", 0.8, 3], max: ["num", 0.8, 3] },
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
  pave: { dia: 1.3, gap: 0.15 },
  paint: [],
  rule: { min_wall: 0.8, shrink: 0 },
});

// Split a line into tokens; {…} groups may contain spaces.
const tokenize = (src) => src.match(/(?:[^\s{]|\{[^}]*\})+/g) || [];

export function parse(text) {
  const d = defaultDesign();
  d.paint = [];
  const errors = [];
  const seen = new Set();
  const lineOf = {};
  const values = {}; // variable name -> number
  const err = (line, message) => errors.push({ line, message });

  // numeric value: plain number, or {expr}; returns { n, raw } or an error string
  const number = (val) => {
    try {
      if (val.startsWith("{") && val.endsWith("}")) {
        return { n: evalExpr(val.slice(1, -1), values), raw: val };
      }
      const n = Number(val);
      if (!Number.isFinite(n) || val === "") return "must be a number";
      return { n };
    } catch (e) {
      return e.message;
    }
  };

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const src = raw.replace(/#.*$/, "").trim();
    if (!src) return;
    const nameMatch = /^design\s+"([^"]*)"\s*$/.exec(src);
    if (nameMatch) {
      d.name = nameMatch[1];
      return;
    }
    const [cmd, ...rest] = tokenize(src);

    if (cmd === "var") {
      const m = /^([A-Za-z_]\w*)=(.+)$/.exec(rest.join(" "));
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
    const obj = cmd === "halo" ? { dia: 1.2, gap: 0.1 } : { ...(d[cmd] && !Array.isArray(d[cmd]) ? d[cmd] : {}) };
    if (cmd === "paint") Object.assign(obj, { s: 0, w: 0, r: 2 });
    for (const tok of rest) {
      const eq = tok.indexOf("=");
      if (eq < 1) {
        err(line, `Expected key=value, got "${tok}"`);
        continue;
      }
      const key = tok.slice(0, eq);
      const val = tok.slice(eq + 1);
      const rule = spec[key];
      if (!rule) {
        err(line, `Unknown option "${key}" for ${cmd}`);
        continue;
      }
      if (rule[0] === "num" || rule[0] === "numauto") {
        if (rule[0] === "numauto" && val === "auto") {
          obj[key] = "auto";
          delete d.exprs[`${cmd}.${key}`];
          continue;
        }
        if (cmd === "paint" && val.startsWith("{")) {
          err(line, "paint values must be plain numbers");
          continue;
        }
        const r = number(val);
        if (typeof r === "string") err(line, `${key} ${r}`);
        else if (r.n < rule[1] || r.n > rule[2]) err(line, `${key} must be between ${rule[1]} and ${rule[2]}`);
        else {
          obj[key] = r.n;
          if (r.raw) d.exprs[`${cmd}.${key}`] = r.raw;
          else delete d.exprs[`${cmd}.${key}`];
        }
      } else if (rule[0] === "size") {
        const s = parseSize(val);
        if (!s) err(line, `size must look like US7, EU54, DE54, IT14 or JP13`);
        else if (!sizeInRange(s)) err(line, `${s.system} size out of range`);
        else obj[key] = formatSize(s.system, s.n);
      } else if (rule[0].includes(val)) obj[key] = val;
      else err(line, `${key} must be one of: ${rule[0].join(", ")}`);
    }
    if (cmd === "paint") d.paint.push(obj);
    else d[cmd] = obj;
  });
  if (d.pave.min !== undefined && d.pave.max !== undefined && d.pave.min > d.pave.max) {
    errors.push({ line: lineOf.pave, message: "pave min must not exceed max" });
  }
  return { design: d, errors };
}

const fmt = (v) => (typeof v === "number" ? String(Math.round(v * 1000) / 1000) : v);
const line = (cmd, obj, exprs = {}) =>
  `${cmd} ${Object.entries(obj).map(([k, v]) => `${k}=${exprs[`${cmd}.${k}`] ?? fmt(v)}`).join(" ")}`;

// An edited field no longer follows its expression: drop it before serializing.
export const setField = (d, cmd, key, value) => {
  d[cmd][key] = value;
  delete d.exprs[`${cmd}.${key}`];
};

export function serialize(d) {
  const out = [`design "${d.name}"`];
  for (const v of d.vars) out.push(`var ${v.name}=${v.raw}`);
  out.push(line("ring", d.ring, d.exprs), line("shank", d.shank, d.exprs), line("stone", d.stone, d.exprs));
  if (d.halo) out.push(line("halo", d.halo, d.exprs));
  out.push(line("pave", d.pave, d.exprs));
  for (const p of d.paint) out.push(line("paint", p));
  out.push(line("rule", d.rule, d.exprs));
  return out.join("\n") + "\n";
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
