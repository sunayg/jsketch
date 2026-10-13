// Pluggable generation provider.
// Set VITE_GENERATE_URL to a server that accepts {prompt, spec} and returns
// {imageUrl}; otherwise the built-in procedural generator is used.
import { drawConcept } from "./sketchRender.js";
import { defaultSpec, describeSpec, parsePrompt } from "./design.js";

const SIZE = 800;

export async function generateConcept(prompt, currentSpec) {
  const spec = { ...(currentSpec || defaultSpec()), ...parsePrompt(prompt) };
  const url = import.meta.env?.VITE_GENERATE_URL;
  let imageUrl;
  if (url) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, spec }),
    });
    if (!res.ok) throw new Error(`Generation failed (${res.status})`);
    imageUrl = (await res.json()).imageUrl;
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    drawConcept(canvas.getContext("2d"), SIZE, spec);
    imageUrl = canvas.toDataURL("image/png");
  }
  return { spec, imageUrl, reply: `Here is a ${describeSpec(spec)}. Refine it by chatting, sketch on the canvas, or open the 3D tab.` };
}
