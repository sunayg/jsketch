// Rule-based design assistant: turns a plain-English request into edits of a
// design. It is not a language model; it understands the phrases below and
// says which words it did not use.
import { CUTS } from "./gems.js";
import { METALS } from "./script.js";

const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
const num = (w) => (w in NUM ? NUM[w] : parseFloat(w));

const METAL_WORDS = [
  [/platinum/, "platinum"],
  [/palladium/, "palladium"],
  [/titanium/, "titanium"],
  [/stainless|steel/, "stainless"],
  [/sterling|silver/, "silver-925"],
  [/22\s*k/, "22k-yellow"],
  [/(9|10|14|18)\s*k(?:t|arat)?\s*(white|rose|yellow)?(?:\s*gold)?|(white|rose|yellow)\s*gold/, null],
];

// carats -> stone width for a cut (inverse of caratOf)
export const diaForCarat = (cut, ct) => Math.cbrt(ct / (CUTS[cut].k * CUTS[cut].aspect));

export function interpret(text, design) {
  const d = structuredClone(design);
  const t = ` ${text.toLowerCase().replace(/[,;]/g, " ")} `;
  const changes = [];
  const used = new Set();
  const use = (m) => m && m[0].trim().split(/\s+/).forEach((w) => used.add(w));

  // ring size
  let m = /\b(?:size|us)\s*(\d+(?:\.\d+)?)\b/.exec(t) || /\b(\d+(?:\.\d+)?)\s*(?:ring\s*)?size\b/.exec(t);
  const sys = /\b(eu|de|it|jp)\s*(\d+(?:\.\d+)?)\b/.exec(t);
  if (sys) {
    d.ring.size = `${sys[1].toUpperCase()}${sys[2]}`;
    delete d.ring.diameter;
    use(sys);
    changes.push(`ring size ${d.ring.size}`);
  } else if (m) {
    d.ring.size = `US${m[1]}`;
    delete d.ring.diameter;
    use(m);
    changes.push(`ring size US${m[1]}`);
  }

  // metal
  for (const [re, key] of METAL_WORDS) {
    const mm = re.exec(t);
    if (!mm) continue;
    let metal = key;
    if (!metal) {
      const karat = mm[1] || "18";
      const colour = mm[2] || mm[3] || "yellow";
      metal = `${karat}k-${colour}`;
      if (!METALS[metal]) metal = `${karat === "9" || karat === "10" ? karat : "18"}k-yellow`;
    }
    d.ring.metal = metal;
    use(mm);
    changes.push(`metal ${METALS[metal].label}`);
    break;
  }

  // plain band / eternity
  if (/\b(eternity)\b/.test(t)) {
    d.stone.setting = "none";
    d.halo = null;
    const C = Math.PI * (d.ring.diameter ?? 17.3) + 12;
    d.regions = d.regions.filter((r) => r.id !== "eternity");
    d.regions.push({ id: "eternity", dia: 1.5, gap: 0.12, setting: "bead", bead: 0.35, mirror: "no", pts: [[-C, -d.shank.width / 2], [C, -d.shank.width / 2], [C, d.shank.width / 2], [-C, d.shank.width / 2]] });
    used.add("eternity");
    changes.push("eternity: stones all the way round, no centre stone");
  } else if (/\b(plain|wedding)\s+band\b/.test(t)) {
    d.stone.setting = "none";
    d.halo = null;
    used.add("plain").add("wedding").add("band");
    changes.push("plain band, no centre stone");
  }

  // cut
  const cutRe = new RegExp(`\\b(${Object.keys(CUTS).join("|").replace("-", "\\\\-")}|emerald-cut|baguette)\\b`);
  const c = cutRe.exec(t);
  if (c) {
    d.stone.cut = c[1].replace("-cut", "");
    if (d.stone.setting === "none" && !/eternity|band/.test(t)) d.stone.setting = "prong";
    use(c);
    changes.push(`${d.stone.cut} centre stone`);
  }

  // size of the centre stone: carats or millimetres
  const ct = /\b(\d+(?:\.\d+)?)\s*(?:ct|carats?|cts)\b/.exec(t);
  const mmSize = /\b(\d+(?:\.\d+)?)\s*mm\s+(?:round|oval|princess|cushion|emerald|pear|marquise|heart|stone|centre|center)/.exec(t);
  const eternity = d.regions.find((r) => r.id === "eternity");
  const melee = /\b(\d+(?:\.\d+)?)\s*mm\s+(?:rounds?|stones?|melee|diamonds?)\b/.exec(t);
  if (eternity && melee) {
    eternity.dia = +melee[1];
    use(melee);
    changes.push(`${melee[1]} mm stones round the band`);
  } else if (ct) {
    d.stone.dia = Math.round(diaForCarat(d.stone.cut, +ct[1]) * 100) / 100;
    use(ct);
    changes.push(`${ct[1]} ct ≈ ${d.stone.dia} mm wide`);
  } else if (mmSize) {
    d.stone.dia = +mmSize[1];
    use(mmSize);
    changes.push(`centre stone ${mmSize[1]} mm`);
  }

  // setting, prongs, tips
  const pr = /\b(\w+)[\s-]prongs?\b/.exec(t) || /\bprongs?\s*(\d)\b/.exec(t);
  if (pr && Number.isFinite(num(pr[1])) && num(pr[1]) >= 3 && num(pr[1]) <= 8) {
    d.stone.setting = "prong";
    d.stone.prongs = num(pr[1]);
    use(pr);
    changes.push(`${d.stone.prongs} prongs`);
  }
  for (const s of ["bezel", "illusion"]) {
    if (new RegExp(`\\b${s}\\b`).test(t)) {
      d.stone.setting = s;
      used.add(s);
      changes.push(`${s} setting`);
    }
  }
  for (const tip of ["claw", "pointed", "flat"]) {
    if (new RegExp(`\\b${tip}\\b`).test(t)) {
      d.stone.tip = tip;
      used.add(tip);
      changes.push(`${tip} prong tips`);
    }
  }

  // halo
  const halo = /\b(?:(double|hidden)\s+)?halo\b/.exec(t);
  if (/\bno\s+halo\b/.test(t)) {
    d.halo = null;
    used.add("no").add("halo");
    changes.push("no halo");
  } else if (halo) {
    d.halo = { dia: 1.2, gap: 0.1, ...(halo[1] ? { kind: halo[1] } : {}) };
    use(halo);
    changes.push(`${halo[1] ? halo[1] + " " : ""}halo`);
  }

  // side stones and shoulder pavé
  if (/\b(three[\s-]stone|side\s+stones?|trilogy)\b/.test(t)) {
    d.accents = d.accents.filter((a) => a.id !== "side");
    d.accents.push({ id: "side", cut: "round", dia: Math.round(d.stone.dia * 0.55 * 10) / 10, s: Math.round((d.stone.dia * 0.55 + d.stone.dia) * 0.6 * 10) / 10, w: 0, setting: "prong", mirror: "yes", prongs: 4 });
    for (const w of ["three", "stone", "three-stone", "side", "stones", "trilogy"]) used.add(w);
    changes.push("mirrored side stones");
  }
  if (/\bpav[eé]\b/.test(t) && !/eternity/.test(t)) {
    d.regions = d.regions.filter((r) => r.id !== "shoulder");
    const h = Math.max(0.6, d.shank.width / 2 - 0.1);
    d.regions.push({ id: "shoulder", dia: "auto", gap: 0.12, setting: "bead", bead: 0.35, mirror: "yes", pts: [[d.stone.dia * 1.1, -h], [26, -h], [26, h], [d.stone.dia * 1.1, h]], min: 0.9, max: 1.5 });
    used.add("pave").add("pavé");
    changes.push("bead-set pavé on both shoulders (auto size)");
  }

  // band dimensions
  const wide = /\b(\d+(?:\.\d+)?)\s*mm\s+(?:wide|width|band)\b/.exec(t);
  if (wide) {
    d.shank.width = +wide[1];
    use(wide);
    changes.push(`band ${wide[1]} mm wide`);
  }
  const thick = /\b(\d+(?:\.\d+)?)\s*mm\s+thick\b/.exec(t);
  if (thick) {
    d.shank.thickness = +thick[1];
    use(thick);
    changes.push(`band ${thick[1]} mm thick`);
  }
  for (const p of ["comfort", "domed", "flat"]) {
    if (new RegExp(`\\b${p}(?:[\\s-]fit)?\\s+(?:band|shank|profile)\\b`).test(t)) {
      d.shank.profile = p;
      used.add(p);
      changes.push(`${p} profile`);
    }
  }

  const FILLER = new Set(["a", "an", "the", "in", "with", "and", "of", "ring", "make", "me", "please", "set", "gold", "k", "solitaire", "engagement", "stone", "stones", "centre", "center", "for", "to", "on", "mm", "it", "band", "tips", "shoulders", "rounds", "prong", "prongs", "size", "cut"]);
  const ignored = t.split(/\s+/).filter((w) => w && !used.has(w) && !FILLER.has(w) && !/^\d/.test(w));
  for (const k of ["ring", "shank", "stone", "pave"]) for (const f of Object.keys(design[k] || {})) if (!(f in d[k])) d[k][f] = design[k][f];
  for (const key of ["stone.dia", "shank.width", "shank.thickness", "ring.diameter"]) {
    const [a, b] = key.split(".");
    if (d[a][b] !== design[a][b]) delete d.exprs[key];
  }
  return { design: d, changes, ignored };
}
