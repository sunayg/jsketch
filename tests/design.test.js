import test from "node:test";
import assert from "node:assert/strict";
import { parsePrompt, describeSpec, defaultSpec } from "../src/design.js";

test("parses metal, gem, cut, size and width", () => {
  const s = parsePrompt("Thin rose gold ring with a large pear sapphire");
  assert.deepEqual(s, { metal: "rose", gem: "sapphire", shape: "pear", kind: "ring", bandWidth: 0.07, gemSize: 0.45 });
});

test("detects pendant and earrings", () => {
  assert.equal(parsePrompt("emerald pendant").kind, "pendant");
  assert.equal(parsePrompt("ruby stud earrings").kind, "earring");
});

test("leaves unmentioned fields out", () => {
  assert.deepEqual(parsePrompt("something pretty"), {});
});

test("describes a spec", () => {
  assert.equal(describeSpec({ ...defaultSpec(), gem: "ruby" }), "round-cut ruby ring in yellow gold");
});
