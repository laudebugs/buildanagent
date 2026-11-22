// The synchronous SHA-256 behind the project-context labels' tokens, checked against Node's own.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "vitest";
import { sha256HexSync } from "../../src/extensions/digest.js";

describe("sha256HexSync", () => {
  test("matches node:crypto across block boundaries and multi-byte characters", () => {
    // 55, 56 and 64 bytes are where the padding and the length move into a second block.
    for (const text of [
      "",
      "abc",
      "a".repeat(55),
      "a".repeat(56),
      "a".repeat(64),
      "a".repeat(119),
      "é😀­".repeat(500),
    ]) {
      assert.equal(sha256HexSync(text), createHash("sha256").update(text).digest("hex"), `${text.length} characters`);
    }
  });

  test("gives the FIPS 180-4 value for abc", () => {
    assert.equal(sha256HexSync("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
