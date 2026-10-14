#!/usr/bin/env node
// Headless JewelScript tool for scripts and AI agents. Output is JSON.
//   cli.js validate <file|->                    parse only
//   cli.js check <file|->                       parse, build and run checks
//   cli.js measure <file|->                     full report
//   cli.js render <file|-> --out dir [--views iso,top,front,side] [--size 512]
//   cli.js export <file|-> --format stl|stl-stones|3mf|bundle|sizerun --out file
//            [--quality draft|standard|fine] [--part id] [--sizes US5-8:0.5]
// Exit codes: 0 ok, 1 script has errors, 2 usage or file problem, 3 checks failed.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { validate, measure, render, exportBytes, ready } from "./node/tools.js";

await ready;

const [cmd, file, ...rest] = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : dflt;
};
const done = (obj, code) => {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(code);
};
const USAGE = "usage: cli.js <validate|check|measure|render|export> <file.jws|-> [options]; see the header of cli.js";

if (!["validate", "check", "measure", "render", "export"].includes(cmd) || !file) {
  console.error(USAGE);
  process.exit(2);
}
let text;
try {
  text = file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8");
} catch (e) {
  done({ ok: false, error: e.code === "ENOENT" ? `File not found: ${file}` : `Cannot read ${file}: ${e.message}` }, 2);
}
const v = validate(text);
if (!v.ok) done({ ok: false, errors: v.errors }, 1);

try {
  if (cmd === "validate") done({ ok: true }, 0);
  if (cmd === "check") {
    const r = measure(text);
    done({ ok: r.ok, checks: r.checks }, r.ok ? 0 : 3);
  }
  if (cmd === "measure") {
    const r = measure(text);
    done(r, r.ok ? 0 : 3);
  }
  if (cmd === "render") {
    const out = opt("out");
    if (!out) done({ ok: false, error: "render needs --out <directory>" }, 2);
    mkdirSync(out, { recursive: true });
    const views = opt("views", "iso,top").split(",");
    const files = render(text, { views, size: Math.min(2048, Math.max(64, +opt("size", 512))) }).map(({ view, png }) => {
      const path = join(out, `${view}.png`);
      writeFileSync(path, png);
      return path;
    });
    done({ ok: true, files }, 0);
  }
  if (cmd === "export") {
    const out = opt("out");
    const format = opt("format");
    if (!out || !format) done({ ok: false, error: "export needs --format and --out" }, 2);
    const { bytes } = exportBytes(text, format, { quality: opt("quality", "standard"), part: opt("part"), sizes: opt("sizes") });
    writeFileSync(out, bytes);
    done({ ok: true, file: out, bytes: bytes.length }, 0);
  }
} catch (e) {
  done({ ok: false, error: e.message }, 2);
}
