// Runs the project-extensions example in temporary projects: trust gates loading, and a pinned folder loads only while
// its files are unchanged.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isHarnessError } from "@buildanagent/harness";
import { pinProjectExtensions } from "@buildanagent/harness/extensions/node";
import { afterAll, test } from "vitest";
import { loadExtensions } from "../../examples/project-extensions.js";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const source = (version: string) => `export default { name: "audit", version: "${version}" };\n`;

/** A project with one extension folder, `audit`. */
function project(): { root: string; file: string } {
  const root = mkdtempSync(join(tmpdir(), "project-extensions-"));
  dirs.push(root);
  const folder = join(root, ".agents", "extensions", "audit");
  mkdirSync(folder, { recursive: true });
  const file = join(folder, "index.mjs");
  writeFileSync(file, source("1.0.0"));
  return { root, file };
}

test("a project the host does not trust loads nothing and says why", async () => {
  const { root } = project();
  const loaded = await loadExtensions(root, false);
  assert.equal(loaded.extensions.length, 0);
  assert.match(loaded.notices[0] ?? "", /the project extensions of .* are skipped: the project is not trusted$/);
});

test("a trusted project with no lock file loads its extension and says it is not pinned", async () => {
  const { root } = project();
  const loaded = await loadExtensions(root, true);
  assert.deepEqual(
    loaded.extensions.map((extension) => extension.name),
    ["audit"],
  );
  assert.match(loaded.notices[0] ?? "", /the extensions of .* are not pinned: there is no .*extensions\.lock\.json$/);
});

test("a pinned extension loads without a notice", async () => {
  const { root } = project();
  await pinProjectExtensions(root);
  const loaded = await loadExtensions(root, true);
  assert.equal(loaded.extensions.length, 1);
  assert.deepEqual(loaded.notices, []);
});

test("an extension whose files changed after pinning is refused with extension_hash_mismatch", async () => {
  const { root, file } = project();
  await pinProjectExtensions(root);
  writeFileSync(file, source("2.0.0"));
  await assert.rejects(loadExtensions(root, true), (error: unknown) => {
    assert.ok(isHarnessError(error));
    assert.equal(error.code, "extension_hash_mismatch");
    assert.equal(error.message, 'the extension "audit" is refused: its files changed since they were pinned');
    return true;
  });
});
