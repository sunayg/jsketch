// JewelScript: a short, line-based design language (millimetres).
//
//   design "Solitaire"
//   ring size=US7 metal=18k-yellow
//   shank width=3 thickness=1.8 profile=comfort
//   stone cut=round dia=6.5 setting=prong prongs=4
//   halo dia=1.2 gap=0.1
//   pave dia=1.3 gap=0.15
//   paint s=0 w=0 r=2
//   rule min_wall=0.8
import { parseSize, sizeInRange, formatSize } from "./sizes.js";
import { CUTS } from "./gems.js";

export const METALS = {
  "18k-yellow": { label: "18k yellow gold", density: 15.5, color: "#e3b94c" },
  "18k-white": { label: "18k white gold", density: 15.6, color: "#dadde2" },
  "18k-rose": { label: "18k rose gold", density: 15.0, color: "#e5a58f" },
  "14k-yellow": { label: "14k yellow gold", density: 13.1, color: "#e0b947" },
  platinum: { label: "Platinum 950", density: 21.4, color: "#cfd3d9" },
  palladium: { label: "Palladium", density: 12.0, color: "#c5c8cc" },
  "silver-925": { label: "Silver 925", density: 10.36, color: "#d8dadd" },
};
export const PROFILES = ["flat", "comfort", "domed"];
export const SETTINGS = ["prong", "bezel"];

// command -> { key: [type, min, max] | [enum values] }
const SCHEMA = {
  design: {},
  ring: { size: ["size"], metal: [Object.keys(METALS)] },
  shank: { width: ["num", 1, 12], thickness: ["num", 0.4, 5], profile: [PROFILES] },
  stone: { cut: [Object.keys(CUTS)], dia: ["num", 1, 15], setting: [SETTINGS], prongs: ["num", 3, 8] },
  halo: { dia: ["num", 0.8, 3], gap: ["num", 0, 1] },
  pave: { dia: ["num", 0.8, 3], gap: ["num", 0, 1] },
  paint: { s: ["num", -200, 200], w: ["num", -10, 10], r: ["num", 0.3, 10] },
  rule: { min_wall: ["num", 0, 3] },
};
const SINGLE = new Set(["design", "ring", "shank", "stone", "halo", "pave", "rule"]);

export const defaultDesign = () => ({
  name: "Untitled ring",
  ring: { size: "US7", metal: "18k-yellow" },
  shank: { width: 3, thickness: 1.8, profile: "comfort" },
  stone: { cut: "round", dia: 6.5, setting: "prong", prongs: 4 },
  halo: null,
  pave: { dia: 1.3, gap: 0.15 },
  paint: [],
  rule: { min_wall: 0.8 },
});

export function parse(text) {
  const d = defaultDesign();
  d.paint = [];
  const errors = [];
  const seen = new Set();
  const err = (line, message) => errors.push({ line, message });
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const src = raw.replace(/#.*$/, "").trim();
    if (!src) return;
    const nameMatch = /^design\s+"([^"]*)"\s*$/.exec(src);
    if (nameMatch) {
      d.name = nameMatch[1];
      return;
    }
    const [cmd, ...rest] = src.split(/\s+/);
    const spec = SCHEMA[cmd];
    if (!spec || cmd === "design") return err(line, cmd === "design" ? 'design needs a quoted name: design "My ring"' : `Unknown command "${cmd}"`);
    if (SINGLE.has(cmd) && seen.has(cmd)) return err(line, `"${cmd}" can only appear once`);
    seen.add(cmd);
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
      if (rule[0] === "num") {
        const n = Number(val);
        if (!Number.isFinite(n) || val === "") err(line, `${key} must be a number`);
        else if (n < rule[1] || n > rule[2]) err(line, `${key} must be between ${rule[1]} and ${rule[2]}`);
        else obj[key] = n;
      } else if (rule[0] === "size") {
        const s = parseSize(val);
        if (!s) err(line, `size must look like US7, EU54 or JP13`);
        else if (!sizeInRange(s)) err(line, `${s.system} size out of range`);
        else obj[key] = formatSize(s.system, s.n);
      } else if (rule[0].includes(val)) obj[key] = val;
      else err(line, `${key} must be one of: ${rule[0].join(", ")}`);
    }
    if (cmd === "paint") d.paint.push(obj);
    else d[cmd] = obj;
  });
  return { design: d, errors };
}

const fmt = (v) => (typeof v === "number" ? String(Math.round(v * 1000) / 1000) : v);
const line = (cmd, obj) => `${cmd} ${Object.entries(obj).map(([k, v]) => `${k}=${fmt(v)}`).join(" ")}`;

export function serialize(d) {
  const out = [`design "${d.name}"`, line("ring", d.ring), line("shank", d.shank), line("stone", d.stone)];
  if (d.halo) out.push(line("halo", d.halo));
  out.push(line("pave", d.pave));
  for (const p of d.paint) out.push(line("paint", p));
  out.push(line("rule", d.rule));
  return out.join("\n") + "\n";
}

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
};
