// Rule-based design assistant: turns a plain-English request into edits of a
// design. It is not a language model. It understands the phrases below, says
// which words it did not use, and refuses (with the reason) any change the
// design language would reject, rather than applying something invalid.
import { CUTS } from "./gems.js";
import { METALS, parse, serialize, LISTS } from "./script.js";

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

// carats -> stone width for a cut (inverse of caratOf)
export const diaForCarat = (cut, ct) => Math.cbrt(ct / (CUTS[cut].k * CUTS[cut].aspect));

// Lower-case, strip accents (pavé -> pave), and turn spoken numbers into digits.
function normalise(text) {
  let t = ` ${text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")} `;
  t = t.replace(/[,;!?]/g, " ").replace(/½/g, ".5").replace(/¼/g, ".25").replace(/¾/g, ".75");
  // fractions: "7 1/4", "7-1/4" -> 7.25; "1/2" -> 0.5
  const frac = (n, dd) => String(Math.round((n / dd) * 1000) / 1000);
  t = t.replace(/\b(\d+)[\s-]+(\d+)\/(\d+)\b/g, (m, w, n, dd) => (+dd && +n < +dd ? String(+w + +frac(+n, +dd)) : m));
  t = t.replace(/\b(\d+)\/(\d+)\b/g, (m, n, dd) => (+dd ? frac(+n, +dd) : m));
  t = t.replace(/\b(\d+)\s+and\s+(?:a\s+)?half\b/g, (_, n) => `${n}.5`);
  t = t.replace(/\b(\d+)\s+and\s+(?:a\s+)?quarter\b/g, (_, n) => `${n}.25`);
  t = t.replace(/\b(\d+)\s+and\s+three\s+quarters?\b/g, (_, n) => `${n}.75`);
  t = t.replace(/\bthree[\s-]quarters?\s+(?:of\s+)?(?:a\s+)?(carat|ct)\b/g, "0.75 $1");
  t = t.replace(/\bhalf\s+(?:a\s+)?(carat|ct)\b/g, "0.5 $1");
  t = t.replace(/\b(?:a\s+)?quarter\s+(?:of\s+)?(?:a\s+)?(carat|ct)\b/g, "0.25 $1");
  t = t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b(?![\s-]*(?:stone|quarter))/g, (w) => String(WORDS[w]));
  t = t.replace(/\b(\d+)\s+and\s+(?:a\s+)?half\b/g, (_, n) => `${n}.5`); // after word -> digit
  return t;
}

const NEG = String.raw`(?:no|not|never|without|remove|delete|drop|lose|take\s+off|take\s+away|get\s+rid\s+of)\b(?:(?!\bbut\b|\binstead\b|\brather\b|\bswap\b|\bwith\b)[^.]){0,20}?\b`;

export function interpret(text, design) {
  const d = structuredClone(design);
  const t = normalise(text);
  const changes = []; // { cmd, text }
  const notes = [];
  const used = new Set();
  const use = (m) => m && m[0].trim().split(/\s+/).forEach((w) => used.add(w));
  const change = (cmd, msg) => changes.push({ cmd, text: msg });
  const negated = (word) => new RegExp(`\\b${NEG}${word}`).exec(t);

  // ring size
  const sys = /\b(eu|de|it|jp)\s*(\d+(?:\.\d+)?)\b/.exec(t);
  const us = /\b(?:size|us)\s*(\d+(?:\.\d+)?)\b/.exec(t) || /\b(\d+(?:\.\d+)?)\s*(?:ring\s*)?size\b/.exec(t);
  if (sys || us) {
    d.ring.size = sys ? `${sys[1].toUpperCase()}${sys[2]}` : `US${us[1]}`;
    delete d.ring.diameter;
    use(sys || us);
    change("ring", `ring size ${d.ring.size}`);
  }

  // metal: only alloys we stock; never substitute silently
  const gold = /\b(9|10|14|18|22)\s*(?:k|kt|karat|carat)\b(?:\s+(white|rose|yellow))?(?:\s+gold)?|\b(white|rose|yellow)\s+gold\b/.exec(t);
  const metalWords = [["platinum", "platinum"], ["palladium", "palladium"], ["titanium", "titanium"], ["(?:stainless|steel)", "stainless"], ["(?:sterling|silver)", "silver-925"], ["brass", "brass"], ["bronze", "bronze"], ["copper", "copper"]];
  // "not platinum" rules a metal out rather than choosing it
  let ruledOut = null;
  for (const [w, key] of metalWords) {
    const neg = negated(w);
    if (!neg) continue;
    use(neg);
    if (d.ring.metal === key) ruledOut = key;
  }
  const named = metalWords.map(([w, key]) => [new RegExp(`\\b${w}\\b`), key, w]).find(([re, , w]) => re.test(t) && !negated(w));
  if (named) {
    d.ring.metal = named[1];
    used.add(named[1].split("-")[0]).add("sterling").add("steel").add("stainless");
    change("ring", `metal ${METALS[named[1]].label}`);
  } else if (gold) {
    const karat = gold[1] || "18";
    const colour = gold[2] || gold[3] || "yellow";
    const key = `${karat}k-${colour}`;
    use(gold);
    if (METALS[key]) {
      d.ring.metal = key;
      change("ring", `metal ${METALS[key].label}`);
    } else notes.push(`${karat}k ${colour} gold is not in the alloy list, so the metal stays ${METALS[d.ring.metal].label}`);
  }
  if (ruledOut && d.ring.metal === ruledOut) notes.push(`You ruled out ${METALS[ruledOut].label} but did not say which metal instead, so it is unchanged; name one (for example 18k white gold)`);

  // plain band / eternity
  if (/\beternity\b/.test(t)) {
    d.stone.setting = "none";
    d.halo = null;
    const C = Math.PI * (d.ring.diameter ?? 17.3) + 12;
    const h = d.shank.width / 2;
    d.regions = d.regions.filter((r) => r.id !== "eternity");
    d.regions.push({ id: "eternity", dia: 1.5, gap: 0.12, setting: "bead", bead: 0.35, mirror: "no", pts: [[-C, -h], [C, -h], [C, h], [-C, h]] });
    used.add("eternity");
    change("region", "eternity: stones all the way round, no centre stone");
  } else if (/\b(plain|wedding)\s+band\b/.test(t)) {
    d.stone.setting = "none";
    d.halo = null;
    used.add("plain").add("wedding").add("band");
    change("stone", "plain band, no centre stone");
  }

  // cut
  const cutRe = new RegExp(`\\b(${Object.keys(CUTS).join("|").replace("-", "\\-")}|emerald-cut)\\b`);
  const c = cutRe.exec(t);
  if (c) {
    d.stone.cut = c[1].replace("-cut", "");
    if (d.stone.setting === "none" && !/eternity|band/.test(t)) d.stone.setting = "prong";
    use(c);
    change("stone", `${d.stone.cut} centre stone`);
  }

  // size of the centre stone: carats or millimetres
  const ct = /\b(\d*\.?\d+)\s*(?:ct|carats?|cts)\b/.exec(t);
  const mmSize = /\b(\d+(?:\.\d+)?)\s*mm\s+(?:round|oval|princess|cushion|emerald|pear|marquise|heart|stone|centre|center)/.exec(t);
  const eternity = d.regions.find((r) => r.id === "eternity");
  const melee = /\b(\d+(?:\.\d+)?)\s*mm\s+(?:rounds?|stones?|melee|diamonds?)\b/.exec(t);
  if (eternity && melee) {
    eternity.dia = +melee[1];
    use(melee);
    change("region", `${melee[1]} mm stones round the band`);
  } else if (ct) {
    d.stone.dia = Math.round(diaForCarat(d.stone.cut, +ct[1]) * 100) / 100;
    use(ct);
    change("stone", `${+ct[1]} ct ≈ ${d.stone.dia} mm wide`);
  } else if (mmSize) {
    d.stone.dia = +mmSize[1];
    use(mmSize);
    change("stone", `centre stone ${mmSize[1]} mm`);
  }

  // prongs: "6 prongs", "six-prong", "prongs to 6", "change prongs to 6", "prong count 6"
  const pr = /\b(\d+)[\s-]prongs?\b/.exec(t) || /\bprongs?\s*(?:count\s*)?(?:to|=|:|of)?\s*(\d+)\b/.exec(t);
  if (pr) {
    d.stone.setting = "prong";
    d.stone.prongs = +pr[1];
    use(pr);
    used.add("change");
    change("stone", `${d.stone.prongs} prongs`);
  }
  for (const s of ["bezel", "illusion"]) {
    if (new RegExp(`\\b${s}\\b`).test(t) && !negated(s)) {
      d.stone.setting = s;
      used.add(s);
      change("stone", `${s} setting`);
    }
  }
  for (const tip of ["claw", "pointed", "flat"]) {
    if (new RegExp(`\\b${tip}\\b`).test(t)) {
      d.stone.tip = tip;
      used.add(tip);
      change("stone", `${tip} prong tips`);
    }
  }

  const noBand = d.shank.profile === "none";
  // halo: add, change kind, or remove
  const noHalo = negated("halo");
  const halo = /\b(?:(double|hidden|single)\s+)?halo\b/.exec(t);
  if (noHalo) {
    d.halo = null;
    use(noHalo);
    change("halo", "no halo");
  } else if (halo) {
    d.halo = { dia: 1.2, gap: 0.1, ...(halo[1] && halo[1] !== "single" ? { kind: halo[1] } : {}) };
    use(halo);
    change("halo", `${halo[1] ? halo[1] + " " : ""}halo`);
    if (d.sculpts.length) notes.push("The halo is placed for a standard head; check that it sits where you want on the sculpt");
  }

  // side stones
  const noSides = negated("(?:side\\s+stones?|accents?)");
  if (noSides) {
    d.accents = [];
    use(noSides);
    change("accent", "no side stones");
  } else if (/\b(3[\s-]stone|three[\s-]stone|side\s+stones?|trilogy)\b/.test(t) && noBand) {
    for (const w of ["3", "three", "stone", "3-stone", "three-stone", "side", "stones", "trilogy"]) used.add(w);
    notes.push("Side stones sit on the band, and this ring has none (shank profile is none); add them on the sculpt with the Surface tool instead");
  } else if (/\b(3[\s-]stone|three[\s-]stone|side\s+stones?|trilogy)\b/.test(t)) {
    d.accents = d.accents.filter((a) => a.id !== "side");
    d.accents.push({ id: "side", cut: "round", dia: Math.round(d.stone.dia * 0.55 * 10) / 10, s: Math.round((d.stone.dia * 0.55 + d.stone.dia) * 0.6 * 10) / 10, w: 0, setting: "prong", mirror: "yes", prongs: 4 });
    for (const w of ["3", "three", "stone", "3-stone", "three-stone", "side", "stones", "trilogy"]) used.add(w);
    change("accent", "mirrored side stones");
  }

  // shoulder pavé
  const noPave = negated("pave");
  if (noPave) {
    d.paint = [];
    d.strokes = [];
    d.regions = d.regions.filter((r) => r.id === "eternity");
    use(noPave);
    change("region", "no pavé on the band");
  } else if (/\bpave\b/.test(t) && !/eternity/.test(t) && noBand) {
    used.add("pave");
    notes.push("Shoulder pavé sits on the band, and this ring has none (shank profile is none); paint pavé on the sculpt with the Surface tool instead");
  } else if (/\bpave\b/.test(t) && !/eternity/.test(t)) {
    d.regions = d.regions.filter((r) => r.id !== "shoulder");
    const h = Math.round(Math.max(0.6, d.shank.width / 2 - 0.1) * 100) / 100;
    const from = Math.round(d.stone.dia * 1.1 * 10) / 10;
    d.regions.push({ id: "shoulder", dia: "auto", gap: 0.12, setting: "bead", bead: 0.35, mirror: "yes", pts: [[from, -h], [26, -h], [26, h], [from, h]], min: 0.9, max: 1.5 });
    used.add("pave");
    change("region", "bead-set pavé on both shoulders (auto size)");
  }

  // band dimensions
  const wide = /\b(\d+(?:\.\d+)?)\s*mm\s+(?:wide|width|band)\b/.exec(t);
  if (wide) {
    d.shank.width = +wide[1];
    use(wide);
    change("shank", `band ${wide[1]} mm wide`);
  }
  const thick = /\b(\d+(?:\.\d+)?)\s*mm\s+thick\b/.exec(t);
  if (thick) {
    d.shank.thickness = +thick[1];
    use(thick);
    change("shank", `band ${thick[1]} mm thick`);
  }
  for (const p of ["comfort", "domed", "flat"]) {
    if (new RegExp(`\\b${p}(?:[\\s-]fit)?\\s+(?:band|shank|profile)\\b`).test(t)) {
      d.shank.profile = p;
      used.add(p);
      change("shank", `${p} profile`);
    }
  }

  // carry over fields the edit did not touch, drop expressions it replaced
  for (const k of ["ring", "shank", "stone", "pave"]) for (const f of Object.keys(design[k] || {})) if (!(f in d[k]) && !(k === "ring" && f === "diameter" && d.ring.size)) d[k][f] = design[k][f];
  if (d.ring.size && design.ring.diameter !== undefined && d.ring.size !== design.ring.size) delete d.ring.diameter;
  for (const key of ["stone.dia", "shank.width", "shank.thickness", "ring.diameter", "ring.size"]) {
    const [a, b] = key.split(".");
    if (d[a][b] !== design[a][b]) delete d.exprs[key];
  }

  // refuse anything the language rejects: put that command back, say why
  const refused = [];
  for (let guard = 0; guard < 10; guard++) {
    const lines = serialize(d).split("\n");
    const { errors } = parse(lines.join("\n"));
    if (!errors.length) break;
    const e = errors[0];
    const cmd = (lines[e.line - 1] || "").split(/\s+/)[0];
    refused.push(`${cmd}: ${e.message}`);
    if (cmd in LISTS) d[LISTS[cmd]] = structuredClone(design[LISTS[cmd]]);
    else if (cmd in design) d[cmd] = structuredClone(design[cmd]);
    else break;
    for (let i = changes.length - 1; i >= 0; i--) if (changes[i].cmd === cmd || (cmd === "region" && changes[i].cmd === "region")) changes.splice(i, 1);
  }
  for (const r of refused) notes.push(`Refused ${r}`);

  const FILLER = new Set(["a", "an", "the", "in", "with", "and", "of", "ring", "make", "me", "please", "set", "gold", "k", "solitaire", "engagement", "stone", "stones", "centre", "center", "for", "to", "on", "mm", "it", "band", "tips", "shoulders", "rounds", "prong", "prongs", "size", "cut", "change", "is", "be", "i", "want", "would", "like", "can", "you", "use", "give", "make", "it's", "its", "that", "this", "but"]);
  const ignored = t.split(/\s+/).filter((w) => w && !used.has(w) && !FILLER.has(w) && !/^\d/.test(w));
  return { design: d, changes: changes.map((c) => c.text), ignored, notes };
}
