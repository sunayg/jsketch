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
