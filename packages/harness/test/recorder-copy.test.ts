// The harness's examples/lib/transcript.ts is a copy of the SDK's, so a change to one that misses the other fails here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

/** A file without its leading `//` header, which differs between the two copies. */
function body(url: URL): string {
  return readFileSync(url, "utf8").replace(/^(?:\/\/[^\n]*\n)+/, "");
}

test("the harness's recorder file matches the SDK's apart from its header", () => {
  const ours = body(new URL("../examples/lib/transcript.ts", import.meta.url));
  const sdk = body(new URL("../../sdk/examples/lib/transcript.ts", import.meta.url));
  assert.equal(
    ours,
    sdk,
    "packages/harness/examples/lib/transcript.ts has drifted from packages/sdk/examples/lib/transcript.ts",
  );
});
