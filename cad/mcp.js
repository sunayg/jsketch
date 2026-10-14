#!/usr/bin/env node
// JewelScript CAD MCP server (stdio). Lets an AI assistant read the language,
// write a design, check it, render it, measure it and export it.
//   Claude Code: claude mcp add jewelscript -- node /path/to/cad/mcp.js
// Exports are written only under $JEWELSCRIPT_OUT (default ./jewelscript-out);
// imported meshes go to $JEWELSCRIPT_ASSETS (default ./jewelscript-assets).
import { createInterface } from "node:readline";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { LANGUAGE_REFERENCE } from "./src/docs.js";
import * as T from "./node/tools.js";

await T.ready;

const OUT = resolve(process.env.JEWELSCRIPT_OUT || "jewelscript-out");
const design = { type: "string", description: "JewelScript design text" };
const TOOLS = [
  { name: "read_docs", description: "The JewelScript language reference. Read this before writing a design.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "browse_catalog", description: "Every command, option range, cut, metal, setting and stocked melee size.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "search_examples", description: "Search the built-in example designs and components by keyword.", inputSchema: { type: "object", properties: { query: { type: "string" }, kind: { type: "string", enum: ["all", "designs", "components"] } } }, annotations: { readOnlyHint: true } },
  { name: "get_example", description: "Get an example design or component's text by exact name.", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] }, annotations: { readOnlyHint: true } },
  { name: "validate_design", description: "Check a design for language errors (with line numbers). Fast; does not build geometry.", inputSchema: { type: "object", properties: { design }, required: ["design"] }, annotations: { readOnlyHint: true } },
  { name: "measure_design", description: "Build the design and report inside diameter, metal weight, stone list with carats, and every manufacturing check.", inputSchema: { type: "object", properties: { design }, required: ["design"] }, annotations: { readOnlyHint: true } },
  { name: "check_stone_fit", description: "Only the stone checks: overlaps, prongs, finger bore, overhangs, holding, metal under culets.", inputSchema: { type: "object", properties: { design }, required: ["design"] }, annotations: { readOnlyHint: true } },
  { name: "render_design", description: "Render shaded pictures of the design (PNG) from one or more views, plus a short summary.", inputSchema: { type: "object", properties: { design, views: { type: "array", items: { type: "string", enum: ["iso", "top", "front", "side"] } }, size: { type: "integer", minimum: 128, maximum: 1024 } }, required: ["design"] }, annotations: { readOnlyHint: true } },
  { name: "compare_designs", description: "Check whether two designs build the same piece; lists differences and a script diff.", inputSchema: { type: "object", properties: { a: design, b: design }, required: ["a", "b"] }, annotations: { readOnlyHint: true } },
  { name: "edit_design", description: "Apply a plain-English change (size, metal, cut, carats, prongs, halo, side stones, pavé, band size) with the built-in rule-based editor; returns the new text and what changed.", inputSchema: { type: "object", properties: { design, request: { type: "string" } }, required: ["design", "request"] }, annotations: { readOnlyHint: true } },
  { name: "import_mesh", description: "Copy a local .stl, .obj or .glb sculpt or scan into the assets folder. Returns its id and a ready `sculpt` line (fit=ring orients and sizes it to the ring; repair=auto rebuilds it as a solid if it is broken).", inputSchema: { type: "object", properties: { path: { type: "string", description: "Path to the mesh file" } }, required: ["path"] }, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: "export_design", description: `Export to a file under ${OUT}: stl (metal), stl-stones, 3mf, glb, obj, bundle (script + meshes) or sizerun (zip of STLs, needs sizes like "US5-8:0.5").`, inputSchema: { type: "object", properties: { design, format: { type: "string", enum: ["stl", "stl-stones", "3mf", "glb", "obj", "bundle", "sizerun"] }, filename: { type: "string" }, quality: { type: "string", enum: ["draft", "standard", "fine"] }, part: { type: "string" }, sizes: { type: "string" } }, required: ["design", "format"] }, annotations: { readOnlyHint: false, destructiveHint: false } },
];

const text = (s) => ({ type: "text", text: typeof s === "string" ? s : JSON.stringify(s, null, 2) });
const fail = (msg, extra) => ({ content: [text(extra ? { error: msg, ...extra } : { error: msg })], isError: true });

async function call(name, a = {}) {
  try {
    switch (name) {
      case "read_docs": return { content: [text(LANGUAGE_REFERENCE)] };
      case "browse_catalog": return { content: [text(T.catalog())] };
      case "search_examples": return { content: [text(T.examples(a.query || "", a.kind || "all"))] };
      case "get_example": return { content: [text(T.example(a.name))] };
      case "validate_design": return { content: [text(T.validate(a.design))] };
      case "measure_design": return { content: [text(await T.measure(a.design))] };
      case "check_stone_fit": return { content: [text(await T.stoneFit(a.design))] };
      case "render_design": {
        const r = await T.measure(a.design);
        const imgs = await T.render(a.design, { views: a.views?.length ? a.views : ["iso", "top"], size: a.size || 512 });
        const summary = `${r.metal.name}, ${r.metal.weightG} g; ${r.stoneCount} stones, ${r.totalCt} ct est.; inside ${r.innerDiameter} mm; checks: ${r.checks.map((c) => c.text).join("; ")}`;
        return { content: [text(summary), ...imgs.flatMap(({ view, png }) => [text(`${view} view:`), { type: "image", data: png.toString("base64"), mimeType: "image/png" }])] };
      }
      case "compare_designs": return { content: [text(await T.compare(a.a, a.b))] };
      case "edit_design": return { content: [text(await T.edit(a.design, a.request || ""))] };
      case "import_mesh": return { content: [text(await T.importMesh(a.path))] };
      case "export_design": {
        const { bytes, ext } = await T.exportBytes(a.design, a.format, a);
        mkdirSync(OUT, { recursive: true });
        // a plain file name: no folders, no dot-only names, at most 80 characters
        let safe = basename(String(a.filename || "")).replace(/[^\w.-]+/g, "_").replace(/\.[^.]*$/, "").replace(/^\.+/, "").slice(0, 80);
        if (!safe) safe = `design-${Date.now()}`;
        const path = join(OUT, `${safe}.${ext}`);
        writeFileSync(path, bytes);
        return { content: [text({ ok: true, file: path, bytes: bytes.length })] };
      }
      default: return fail(`Unknown tool ${name}`);
    }
  } catch (e) {
    return fail(e.message, e.errors ? { errors: e.errors } : undefined);
  }
}

function handle(msg) {
  const { id, method, params } = msg;
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  if (method === "initialize") {
    return ok({
      protocolVersion: params?.protocolVersion || "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "jewelscript-cad", version: "0.3.0" },
      instructions: "Read read_docs first. Write designs as JewelScript text, then validate_design, measure_design and render_design before showing the user. Use export_design for files.",
    });
  }
  if (method === "ping") return ok({});
  if (method === "tools/list") return ok({ tools: TOOLS });
  if (method === "tools/call") return call(params?.name, params?.arguments).then(ok);
  if (id === undefined) return null; // notifications need no reply
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n");
    return;
  }
  Promise.resolve(handle(msg)).then((reply) => {
    if (reply) process.stdout.write(JSON.stringify(reply) + "\n");
  });
});
