// Ring size systems -> inner diameter in mm.
// US: linear fit. EU/DE: size is the inner circumference in mm. IT and JP:
// inner circumference is size + 40 mm. UK, HK and MATRIX are not included.
export function parseSize(text) {
  const m = /^(US|EU|DE|IT|JP)\s*(\d+(?:\.\d+)?)$/i.exec(String(text).trim());
  if (!m) return null;
  const system = m[1].toUpperCase();
  const n = parseFloat(m[2]);
  let d;
  if (system === "US") d = 11.63 + 0.8128 * n;
  else if (system === "EU" || system === "DE") d = n / Math.PI;
  else d = (n + 40) / Math.PI; // IT, JP
  return { system, n, innerDiameter: d };
}

export const RANGE = { US: [0, 16], EU: [35, 75], DE: [35, 75], IT: [0, 35], JP: [1, 30] };

export function sizeInRange(s) {
  const [lo, hi] = RANGE[s.system];
  return s.n >= lo && s.n <= hi;
}

export function formatSize(system, n) {
  return `${system}${n}`;
}

// The size in another system that is closest to an inside diameter (mm).
const STEP = { US: 0.25, EU: 0.5, DE: 0.5, IT: 0.5, JP: 0.5 };
export function sizeFromDiameter(system, d) {
  const raw = system === "US" ? (d - 11.63) / 0.8128 : system === "EU" || system === "DE" ? d * Math.PI : d * Math.PI - 40;
  const step = STEP[system];
  const [lo, hi] = RANGE[system];
  const n = Math.min(hi, Math.max(lo, Math.round(raw / step) * step));
  return `${system}${+n.toFixed(2)}`;
}
