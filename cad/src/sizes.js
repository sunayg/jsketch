// Ring size systems -> inner diameter in mm.
// US: standard linear fit. EU: size is the inner circumference in mm.
// JP: size n has inner circumference (n + 40) mm.
export function parseSize(text) {
  const m = /^(US|EU|JP)\s*(\d+(?:\.\d+)?)$/i.exec(String(text).trim());
  if (!m) return null;
  const system = m[1].toUpperCase();
  const n = parseFloat(m[2]);
  let d;
  if (system === "US") d = 11.63 + 0.8128 * n;
  else if (system === "EU") d = n / Math.PI;
  else d = (n + 40) / Math.PI;
  return { system, n, innerDiameter: d };
}

export const RANGE = { US: [0, 16], EU: [35, 75], JP: [1, 30] };

export function sizeInRange(s) {
  const [lo, hi] = RANGE[s.system];
  return s.n >= lo && s.n <= hi;
}

export function formatSize(system, n) {
  return `${system}${n}`;
}
