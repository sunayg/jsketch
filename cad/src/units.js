// Display units for the tech sheet. Base units: g, ct, mm.
export const WEIGHT = {
  g: { label: "g", per: 1 },
  dwt: { label: "dwt", per: 1.55517384 },
  ozt: { label: "ozt", per: 31.1034768 },
  tola: { label: "tola", per: 11.6638038 },
};
export const GEM_WEIGHT = {
  ct: { label: "ct", per: 1, digits: 3 },
  mg: { label: "mg", per: 0.005, digits: 0 },
  pts: { label: "pts", per: 0.01, digits: 1 },
};
export const LENGTH = {
  mm: { label: "mm", per: 1 },
  cm: { label: "cm", per: 10 },
  in: { label: "in", per: 25.4 },
};

export const weightIn = (g, unit) => g / WEIGHT[unit].per;
export const gemIn = (ct, unit) => ct / GEM_WEIGHT[unit].per;
export const lengthIn = (mm, unit) => mm / LENGTH[unit].per;
