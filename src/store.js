import { defaultSpec } from "./design.js";

const KEY = "jsketch.journeys.v1";

export const newJourney = (name = "Untitled design") => ({
  id: crypto.randomUUID(),
  name,
  updatedAt: Date.now(),
  spec: defaultSpec(),
  layers: [{ id: crypto.randomUUID(), name: "Sketch", visible: true, dataUrl: null }],
  messages: [{ role: "assistant", text: "Describe a piece, e.g. “thin rose gold ring with a large pear sapphire”." }],
});

export function loadJourneys() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (Array.isArray(raw) && raw.length) return raw;
  } catch {}
  return [newJourney("My first design")];
}

export function saveJourneys(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false; // quota exceeded or storage blocked
  }
}
