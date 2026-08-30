import assert from "node:assert/strict";
import test from "node:test";
import { filename } from "../src/validation.js";

const BACKSLASH = String.fromCharCode(0x5c);
const NUL = String.fromCharCode(0);

test("keeps ordinary filenames intact", () => {
  assert.equal(filename.parse("  Quarterly Report.pdf  "), "Quarterly Report.pdf");
});

test("flattens path traversal attempts", () => {
  assert.equal(filename.parse("../../etc/passwd"), "..-..-etc-passwd");
  assert.equal(
    filename.parse(`C:${BACKSLASH}Windows${BACKSLASH}system32.dll`),
    "C:-Windows-system32.dll"
  );
});

test("strips control characters that could forge a response header", () => {
  assert.equal(filename.parse("bad\r\nX-Evil: 1.txt"), "badX-Evil: 1.txt");
});

test("rejects names that sanitise down to nothing", () => {
  assert.throws(() => filename.parse(NUL + NUL));
  assert.throws(() => filename.parse("   "));
  assert.throws(() => filename.parse(".."));
  assert.throws(() => filename.parse("x".repeat(256)));
});
