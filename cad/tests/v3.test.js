import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, serialize, mergeText, defaultDesign } from "../src/script.js";
import { build } from "../src/build.js";
import { report } from "../src/report.js";
import { DESIGNS, COMPONENTS, search } from "../src/library.js";
import { interpret, diaForCarat } from "../src/assistant.js";
import { techSheetHtml, gemMapSvg } from "../src/techsheet.js";
import { renderPng } from "../node/render.js";
import { caratOf } from "../src/gems.js";

const CLI = new URL("../cli.js", import.meta.url).pathname;
const MCP = new URL("../mcp.js", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "jws-"));

test("language: strict numbers, whole numbers, repeated keys, names with # and quotes", () => {
  const r = parse('design "Ring #1 \\"A\\""\nstone prongs=4.5 dia=0x3\naccent id=a dia=2 dia=3\nvar band = 1.8\nshank thickness={band}');
  assert.equal(r.design.name, 'Ring #1 "A"');
  assert.deepEqual(r.errors.map((e) => e.message), ["prongs must be a whole number", "dia must be a number", "dia is given twice"]);
  assert.equal(r.design.shank.thickness, 1.8);
  assert.match(serialize(r.design), /^design "Ring #1 \\"A\\""/);
  assert.match(parse("shank thickness={b}\nvar b=2").errors[0].message, /before it is defined on line 2/);
  assert.match(parse("shank width={2**3}").errors[0].message, /no \*\* power/);
  assert.match(parse("shank width={2*").errors[0].message, /unclosed/);
  assert.match(parse("# nothing\n").errors[0].message, /empty/);
  assert.match(parse("ring size=US7 diameter=18").errors[0].message, /either size= or diameter=/);
});

test("mergeText keeps comments, blank lines, order and inline comments", () => {
  const text = 'design "x"  # top\n# note\nring size=US7 metal=18k-yellow\n\nshank width=3 thickness=1.8 profile=comfort  # keep\nstone cut=round dia=6.5 setting=prong prongs=4\naccent id=a cut=round dia=2 s=12 w=0 setting=bezel mirror=no\n# end\nrule min_wall=0.8 shrink=0\n';
  const d = parse(text).design;
  d.shank.width = 4;
  d.accents = [];
  d.halo = { dia: 1.2, gap: 0.1 };
  const out = mergeText(text, d);
  for (const keep of ["# note", "# keep", "# end", "  # top", "\n\nshank width=4"]) assert.ok(out.includes(keep), keep);
  assert.ok(!out.includes("accent id=a"));
  assert.ok(out.indexOf("halo dia=1.2") > out.indexOf("stone cut=round") && out.indexOf("halo dia=1.2") < out.indexOf("# end"));
  assert.deepEqual(parse(out).design, parse(serialize(d)).design);
});

test("every library design and component passes its own checks", () => {
  for (const d of DESIGNS) {
    const p = parse(d.text);
    assert.deepEqual(p.errors, [], d.name);
    const r = report(build(p.design));
    assert.ok(r.ok && r.checks.every((c) => c.level === "ok"), `${d.name}: ${JSON.stringify(r.checks)}`);
  }
  for (const c of COMPONENTS) {
    const p = parse(`${DESIGNS[0].text}${c.text}\n`);
    assert.deepEqual(p.errors, [], c.name);
    assert.ok(report(build(p.design)).ok, c.name);
  }
  assert.ok(search("eternity").some((x) => x.name === "Eternity band"));
  assert.ok(search("pear", "components").every((x) => x.kind === "component"));
});

test("halos clear the prongs on every cut", () => {
  for (const cut of ["round", "pear", "heart", "trillion", "marquise", "princess", "tapered-baguette"]) {
    for (const kind of ["single", "double", "hidden"]) {
      const d = defaultDesign();
      Object.assign(d.stone, { cut, dia: 6 });
      d.halo = { dia: 1.2, gap: 0.1, kind };
      const r = report(build(d));
      assert.ok(r.ok, `${cut}/${kind}: ${JSON.stringify(r.checks)}`);
    }
  }
});

test("assistant understands common requests and says what it skipped", () => {
  const r = interpret("A size 6.5 platinum solitaire with a 1 ct oval in six prongs, sparkly", defaultDesign());
  assert.equal(r.design.ring.size, "US6.5");
  assert.equal(r.design.ring.metal, "platinum");
  assert.equal(r.design.stone.cut, "oval");
  assert.equal(r.design.stone.prongs, 6);
  assert.ok(Math.abs(caratOf("oval", r.design.stone.dia) - 1) < 0.02);
  assert.deepEqual(r.ignored, ["sparkly"]);
  const e = interpret("eternity band of 2 mm rounds in 18k white gold", defaultDesign());
  assert.equal(e.design.stone.setting, "none");
  assert.equal(e.design.regions[0].dia, 2);
  assert.ok(report(build(e.design)).stoneCount > 25);
  assert.ok(Math.abs(diaForCarat("round", 1) - 6.5) < 0.05);
});

test("tech sheet escapes notes and maps every stone", () => {
  const d = parse(DESIGNS.find((x) => x.name === "Halo ring").text).design;
  const m = build(d);
  const r = report(m);
  const html = techSheetHtml({ design: d, report: r, views: [], gemMap: gemMapSvg(m, r), units: { weight: "dwt", gem: "pts", length: "in" }, notes: "<script>x</script>", densityOverride: 15 });
  assert.ok(html.includes("&lt;script&gt;") && !html.includes("<script>x"));
  assert.equal((html.match(/<polygon/g) || []).length, r.stoneCount);
  assert.match(html, /house density/);
});

test("software renderer writes a valid PNG", () => {
  const png = renderPng(build(defaultDesign(), { quality: "draft" }), { view: "iso", size: 128 });
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 128);
});

test("CLI exit codes and JSON", () => {
  const good = join(dir, "good.jws"), thin = join(dir, "thin.jws");
  writeFileSync(good, DESIGNS[0].text);
  writeFileSync(thin, 'design "t"\nring size=US7 metal=platinum\nshank width=3 thickness=0.5 profile=flat\n');
  const run = (...args) => spawnSync("node", [CLI, ...args], { encoding: "utf8", input: args.includes("-") ? "ring size=US99\n" : undefined });
  assert.equal(run("validate", good).status, 0);
  assert.equal(run("check", thin).status, 3);
  assert.equal(run("validate", "-").status, 1);
  const missing = run("measure", join(dir, "nope.jws"));
  assert.equal(missing.status, 2);
  assert.match(JSON.parse(missing.stdout).error, /File not found/);
  assert.equal(run("bogus").status, 2);
  const m = JSON.parse(run("measure", good).stdout);
  assert.equal(String(m.innerDiameter).split(".")[1]?.length <= 4, true);
  const out = join(dir, "r.3mf");
  assert.equal(run("export", good, "--format", "3mf", "--out", out).status, 0);
  assert.equal(readFileSync(out).subarray(0, 2).toString(), "PK");
});

test("MCP server speaks JSON-RPC over stdio", async () => {
  const p = spawn("node", [MCP], { env: { ...process.env, JEWELSCRIPT_OUT: join(dir, "mcp") } });
  let buf = "";
  const waiting = new Map();
  p.stdout.on("data", (d) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0; ) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      waiting.get(msg.id)?.(msg);
    }
  });
  let n = 0;
  const rpc = (method, params) => new Promise((res) => {
    waiting.set(++n, res);
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
  });
  try {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    assert.equal(init.result.serverInfo.name, "jewelscript-cad");
    const tools = (await rpc("tools/list", {})).result.tools.map((t) => t.name);
    for (const t of ["read_docs", "validate_design", "measure_design", "render_design", "export_design"]) assert.ok(tools.includes(t), t);
    const r = (await rpc("tools/call", { name: "render_design", arguments: { design: DESIGNS[0].text, views: ["top"], size: 128 } })).result;
    assert.equal(r.content.find((c) => c.type === "image").mimeType, "image/png");
    const bad = (await rpc("tools/call", { name: "measure_design", arguments: { design: "shank width=abc" } })).result;
    assert.equal(bad.isError, true);
    const ex = JSON.parse((await rpc("tools/call", { name: "export_design", arguments: { design: DESIGNS[0].text, format: "stl", filename: "../../escape" } })).result.content[0].text);
    assert.ok(ex.file.startsWith(join(dir, "mcp")), ex.file);
    assert.equal((await rpc("nope", {})).error.code, -32601);
  } finally {
    p.kill();
  }
});
