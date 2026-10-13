// Pure design logic: prompt parsing and default ring parameters.
export const METALS = {
  gold: { label: "Yellow gold", color: "#e0b341", roughness: 0.25 },
  rose: { label: "Rose gold", color: "#e3a58f", roughness: 0.25 },
  silver: { label: "Silver", color: "#d4d7dc", roughness: 0.2 },
  platinum: { label: "Platinum", color: "#c9ced6", roughness: 0.15 },
};

export const GEMS = {
  diamond: { label: "Diamond", color: "#eaf6ff" },
  ruby: { label: "Ruby", color: "#d0113c" },
  emerald: { label: "Emerald", color: "#0e9f5a" },
  sapphire: { label: "Sapphire", color: "#1d46c8" },
  amethyst: { label: "Amethyst", color: "#8a4fd0" },
};

export const SHAPES = ["round", "square", "pear", "oval"];
export const KINDS = ["ring", "pendant", "earring"];

export const defaultSpec = () => ({
  kind: "ring",
  metal: "gold",
  gem: "diamond",
  shape: "round",
  bandWidth: 0.12,
  gemSize: 0.32,
});

const METAL_WORDS = {
  rose: ["rose gold", "rose"],
  platinum: ["platinum"],
  silver: ["silver", "sterling"],
  gold: ["gold", "yellow gold"],
};

// Turn free text into a partial spec. Unmentioned fields are left out.
export function parsePrompt(text) {
  const t = text.toLowerCase();
  const spec = {};
  for (const [metal, words] of Object.entries(METAL_WORDS)) {
    if (words.some((w) => t.includes(w))) {
      spec.metal = metal;
      break;
    }
  }
  for (const gem of Object.keys(GEMS)) {
    if (t.includes(gem)) spec.gem = gem;
  }
  if (t.includes("solitaire") && !spec.gem) spec.gem = "diamond";
  for (const shape of SHAPES) if (t.includes(shape)) spec.shape = shape;
  if (t.includes("princess")) spec.shape = "square";
  if (t.includes("teardrop")) spec.shape = "pear";
  if (/\b(necklace|pendant|locket)\b/.test(t)) spec.kind = "pendant";
  else if (/\b(earrings?|studs?)\b/.test(t)) spec.kind = "earring";
  else if (/\b(ring|band|engagement)\b/.test(t)) spec.kind = "ring";
  if (/\b(thin|delicate|slim|dainty)\b/.test(t)) spec.bandWidth = 0.07;
  if (/\b(thick|chunky|wide|bold)\b/.test(t)) spec.bandWidth = 0.2;
  if (/\b(large|big|statement)\b/.test(t)) spec.gemSize = 0.45;
  if (/\b(small|tiny|subtle)\b/.test(t)) spec.gemSize = 0.22;
  return spec;
}

export function describeSpec(s) {
  return `${s.shape}-cut ${GEMS[s.gem].label.toLowerCase()} ${s.kind} in ${METALS[s.metal].label.toLowerCase()}`;
}
