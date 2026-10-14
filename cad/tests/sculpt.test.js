import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { initKernel } from "../src/kernel.js";
import { prepareSculpt, transformSoup } from "../src/sculpt.js";
import { readStl, readObj, readGlb, assetId } from "../src/meshio.js";
import { parseSize } from "../src/sizes.js";

await initKernel();
const soupOf = (geo) => Float32Array.from((geo.index ? geo.toNonIndexed() : geo).attributes.position.array);
// an "AI sculpt" of a ring: a torus with a lump for a head, in odd units and orientation
function fakeRing() {
  const band = new THREE.TorusGeometry(0.5, 0.08, 24, 96);
  const head = new THREE.SphereGeometry(0.16, 24, 16);
  head.translate(0, 0.6, 0);
  const g = mergeGeometries([band, head].map((x) => x.toNonIndexed()).map((x) => (x.deleteAttribute("uv"), x.deleteAttribute("normal"), x)));
  return transformSoup(soupOf(g), { scale: 37, rx: 70, ry: 20, rz: 15, x: 40, y: -12, z: 3 });
}
const innerRadius = (manifold) => {
  const mesh = manifold.getMesh();
  let rmin = Infinity;
  for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp) {
    const [x, y] = [mesh.vertProperties[i], mesh.vertProperties[i + 1]];
    rmin = Math.min(rmin, Math.hypot(x, y));
  }
  return rmin;
};

test("fit=ring orients, centres and scales a sculpt to the ring size", () => {
  const target = parseSize("US7").innerDiameter;
  const { manifold, info } = prepareSculpt(fakeRing(), { fit: "ring", repair: "voxel", voxel: 0.12 }, { innerDiameter: target });
  assert.ok(Math.abs(innerRadius(manifold) * 2 - target) < 0.35, `bore ${innerRadius(manifold) * 2} vs ${target}`);
  const box = manifold.boundingBox();
  assert.ok(box.max[1] > -box.min[1] + 1, "head points up (+Y)");
  assert.ok(box.max[2] - box.min[2] < box.max[0] - box.min[0], "finger axis is Z (thinnest direction)");
  assert.equal(info.method, "voxel");
  manifold.delete();
});

test("a sculpt with holes is rebuilt watertight with about the right volume", () => {
  const torus = soupOf(new THREE.TorusGeometry(10, 1.5, 32, 128));
  const exactVol = 2 * Math.PI * Math.PI * 10 * 1.5 * 1.5;
  const holed = [];
  for (let t = 0; t < torus.length; t += 9) if ((t / 9) % 25 !== 7) holed.push(...torus.subarray(t, t + 9)); // drop 4% of triangles
  const soup = Float32Array.from(holed);
  assert.throws(() => prepareSculpt(soup, { repair: "none" }), /not watertight/);
  const { manifold, info } = prepareSculpt(soup, { repair: "auto", close: 2, voxel: 0.12 });
  assert.equal(info.notWatertight, true);
  assert.equal(info.method, "voxel");
  assert.equal(String(manifold.status()), "NoError");
  assert.ok(Math.abs(manifold.volume() - exactVol) / exactVol < 0.06, `${manifold.volume()} vs ${exactVol}`);
  manifold.delete();
});

test("a clean sculpt goes straight in; debris is removed", () => {
  const main = soupOf(new THREE.SphereGeometry(6, 48, 32));
  const crumb = transformSoup(soupOf(new THREE.SphereGeometry(0.4, 12, 8)), { x: 15 });
  const both = new Float32Array(main.length + crumb.length);
  both.set(main);
  both.set(crumb, main.length);
  const { manifold, info } = prepareSculpt(both, {});
  assert.equal(info.method, "direct");
  assert.equal(info.pieces, 2);
  assert.equal(info.removedPieces, 1);
  assert.ok(manifold.boundingBox().max[0] < 7);
  manifold.delete();
});

test("hollowing leaves a shell of the requested wall", () => {
  const { manifold } = prepareSculpt(soupOf(new THREE.SphereGeometry(5, 64, 48)), { hollow: 0.8, voxel: 0.1 });
  const shell = (4 / 3) * Math.PI * (5 ** 3 - 4.2 ** 3);
  assert.ok(Math.abs(manifold.volume() - shell) / shell < 0.08, `${manifold.volume()} vs ${shell}`);
  // one body with one cavity inside it
  const parts = manifold.decompose();
  assert.equal(parts.filter((p) => p.volume() > 0).length, 1);
  assert.equal(parts.filter((p) => p.volume() < 0).length, 1);
  for (const p of parts) p.delete();
  manifold.delete();
});

test("symmetrize mirrors the good half across x = 0", () => {
  const lop = transformSoup(soupOf(new THREE.BoxGeometry(10, 4, 4, 4, 2, 2)), { x: 2 }); // spans x -3..7
  const { manifold } = prepareSculpt(lop, { symmetrize: "x+" });
  const b = manifold.boundingBox();
  assert.ok(Math.abs(b.max[0] - 7) < 1e-3 && Math.abs(b.min[0] + 7) < 1e-3, JSON.stringify(b));
  manifold.delete();
});

test("unscaled sculpts are flagged", () => {
  const { manifold, info } = prepareSculpt(soupOf(new THREE.SphereGeometry(0.5, 24, 16)), {});
  assert.equal(info.unscaled, true);
  manifold.delete();
});

test("mesh readers: binary and ASCII STL, OBJ with quads, GLB", async () => {
  const soup = soupOf(new THREE.BoxGeometry(2, 2, 2));
  const n = soup.length / 9;
  const bin = new Uint8Array(84 + n * 50);
  const dv = new DataView(bin.buffer);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + t * 50 + 12 + k * 4, soup[t * 9 + k], true);
  assert.deepEqual(Array.from(readStl(bin)), Array.from(soup));
  const ascii = new TextEncoder().encode("solid a\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid a\n");
  assert.equal(readStl(ascii).length, 9);
  assert.equal(readObj("v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n").length, 18);
  // a one-triangle GLB with a translated node
  const json = { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, translation: [5, 0, 0] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }], bufferViews: [{ buffer: 0, byteLength: 36 }], buffers: [{ byteLength: 36 }] };
  const jb = new TextEncoder().encode(JSON.stringify(json).padEnd(Math.ceil(JSON.stringify(json).length / 4) * 4, " "));
  const vb = new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  const glb = new Uint8Array(12 + 8 + jb.length + 8 + vb.length);
  const g = new DataView(glb.buffer);
  g.setUint32(0, 0x46546c67, true); g.setUint32(4, 2, true); g.setUint32(8, glb.length, true);
  g.setUint32(12, jb.length, true); g.setUint32(16, 0x4e4f534a, true); glb.set(jb, 20);
  g.setUint32(20 + jb.length, vb.length, true); g.setUint32(24 + jb.length, 0x004e4942, true); glb.set(vb, 28 + jb.length);
  assert.deepEqual(Array.from(readGlb(glb)), [5, 0, 0, 6, 0, 0, 5, 1, 0]);
  assert.match(await assetId(bin), /^[0-9a-f]{16}$/);
});

test("CLI and MCP: a broken AI ring sculpt is imported, repaired, fitted and measured", async () => {
  const { spawnSync, spawn } = await import("node:child_process");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "sculpt-"));
  // ring + head + crumb, odd units and angle, 3% of triangles missing
  const band = new THREE.TorusGeometry(0.5, 0.07, 32, 128);
  const head = new THREE.SphereGeometry(0.17, 32, 24);
  head.translate(0, 0.6, 0);
  const crumb = new THREE.SphereGeometry(0.02, 8, 6);
  crumb.translate(0.9, 0.9, 0);
  const g = mergeGeometries([band, head, crumb].map((x) => x.toNonIndexed()).map((x) => (x.deleteAttribute("uv"), x.deleteAttribute("normal"), x)));
  const all = transformSoup(Float32Array.from(g.attributes.position.array), { scale: 37, rx: 70, ry: 20, rz: 15 });
  const kept = [];
  for (let t = 0; t < all.length; t += 9) if ((t / 9) % 33 !== 5) kept.push(...all.subarray(t, t + 9));
  const n = kept.length / 9, bin = new Uint8Array(84 + n * 50), dv = new DataView(bin.buffer);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + t * 50 + 12 + k * 4, kept[t * 9 + k], true);
  writeFileSync(join(dir, "ai-ring.stl"), bin);
  const script = 'design "AI ring"\nring size=US6.5 metal=18k-yellow\nshank width=3 thickness=1.8 profile=none\nstone cut=round dia=4 setting=none\nsculpt id=ring src=ai-ring.stl fit=ring repair=auto close=2 smooth=1\n';
  writeFileSync(join(dir, "ai.jws"), script);
  const cli = new URL("../cli.js", import.meta.url).pathname;
  const r = spawnSync("node", [cli, "measure", join(dir, "ai.jws")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const m = JSON.parse(r.stdout);
  assert.equal(m.metal.exact, true);
  const info = m.sculpts.ring;
  assert.equal(info.method, "voxel");
  assert.equal(info.removedPieces, 1);
  assert.ok(info.size[1] > info.size[0] + 2, `head on top: ${info.size}`);
  assert.ok(m.metal.weightG > 5 && m.metal.weightG < 10, String(m.metal.weightG));

  // MCP: import the mesh into the assets folder, then use the returned line
  const mcp = spawn("node", [new URL("../mcp.js", import.meta.url).pathname], { env: { ...process.env, JEWELSCRIPT_ASSETS: join(dir, "assets") } });
  let buf = "";
  const waiting = new Map();
  mcp.stdout.on("data", (d) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0; ) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      waiting.get(msg.id)?.(msg);
    }
  });
  let id = 0;
  const rpc = (method, params) => new Promise((res) => {
    waiting.set(++id, res);
    mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  try {
    await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    const imp = JSON.parse((await rpc("tools/call", { name: "import_mesh", arguments: { path: join(dir, "ai-ring.stl") } })).result.content[0].text);
    assert.match(imp.id, /^[0-9a-f]{16}$/);
    const design = script.replace(/sculpt .*\n/, `${imp.line}\n`); // the suggested line works as given
    const res = (await rpc("tools/call", { name: "render_design", arguments: { design, views: ["iso"], size: 128 } })).result;
    assert.ok(!res.isError, JSON.stringify(res.content[0]));
    assert.ok(res.content.some((c) => c.type === "image"));
  } finally {
    mcp.kill();
  }
});
