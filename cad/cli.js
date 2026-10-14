#!/usr/bin/env node
// Headless tool for scripts and AI agents.
//   node cad/cli.js validate design.jws
//   node cad/cli.js measure design.jws     (JSON report)
import { readFileSync } from "node:fs";
import { parse } from "./src/script.js";
import { build } from "./src/build.js";
import { report } from "./src/report.js";

const [cmd, file] = process.argv.slice(2);
if (!["validate", "measure"].includes(cmd) || !file) {
  console.error("usage: cli.js <validate|measure> <file.jws>");
  process.exit(2);
}
const { design, errors } = parse(readFileSync(file, "utf8"));
if (errors.length) {
  console.log(JSON.stringify({ ok: false, errors }, null, 2));
  process.exit(1);
}
if (cmd === "validate") {
  console.log(JSON.stringify({ ok: true }));
} else {
  const r = report(build(design));
  console.log(JSON.stringify({ ...r, stones: r.stones.map((s) => ({ ...s })) }, null, 2));
  process.exit(r.ok ? 0 : 1);
}
