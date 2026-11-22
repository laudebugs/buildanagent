// Content-hash pins: a changed, added or unlisted extension is refused.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isHarnessError } from "@buildanagent/harness";
import { memoryTrustStore } from "@buildanagent/harness/extensions";
import {
  hashExtensionDir,
  loadProjectExtensions,
  pinProjectExtensions,
  readLock,
} from "@buildanagent/harness/extensions/node";
import { afterAll, describe, test } from "vitest";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "harness-lock-"));
  dirs.push(root);
  const folder = join(root, ".agents", "extensions", "audit");
  mkdirSync(join(folder, "lib"), { recursive: true });
  writeFileSync(
    join(folder, "index.mjs"),
    'import { v } from "./lib/v.mjs";\nexport default { name: "audit", version: v };\n',
  );
  writeFileSync(join(folder, "lib", "v.mjs"), 'export const v = "1.0.0";\n');
  return root;
}
const folderOf = (root: string) => join(root, ".agents", "extensions", "audit");
const load = (root: string) => loadProjectExtensions(root, { trust: memoryTrustStore([root]), headless: false });
const mismatch = (error: unknown) => isHarnessError(error) && error.code === "extension_hash_mismatch";

describe("hashExtensionDir", () => {
  test("the hash is the same for the same files and changes with any file's content, name or presence", async () => {
    const root = project();
    const before = await hashExtensionDir(folderOf(root));
    assert.equal(await hashExtensionDir(folderOf(root)), before);
    writeFileSync(join(folderOf(root), "lib", "v.mjs"), 'export const v = "1.0.1";\n');
    const changed = await hashExtensionDir(folderOf(root));
    assert.notEqual(changed, before);
    writeFileSync(join(folderOf(root), "extra.txt"), "x");
    assert.notEqual(await hashExtensionDir(folderOf(root)), changed);
  });

  test("two folders with the same files under other names hash alike, and a rename of a file changes the hash", async () => {
    const a = project();
    const b = project();
    assert.equal(await hashExtensionDir(folderOf(a)), await hashExtensionDir(folderOf(b)));
    writeFileSync(join(folderOf(b), "lib", "w.mjs"), 'export const v = "1.0.0";\n');
    rmSync(join(folderOf(b), "lib", "v.mjs"));
    writeFileSync(join(folderOf(b), "lib", "v.mjs"), 'export const v = "1.0.0";\n');
    assert.notEqual(await hashExtensionDir(folderOf(a)), await hashExtensionDir(folderOf(b)));
  });
});

describe("the lock file", () => {
  test("pinning writes one hash per extension folder, and a matching project loads", async () => {
    const root = project();
    const pins = await pinProjectExtensions(root);
    assert.deepEqual([...pins.keys()], ["audit"]);
    const lock = JSON.parse(readFileSync(join(root, ".agents", "extensions.lock.json"), "utf8"));
    assert.equal(lock.version, 1);
    assert.equal(lock.extensions.audit, pins.get("audit"));
    const result = await load(root);
    assert.deepEqual(
      result.extensions.map((e) => e.name),
      ["audit"],
    );
    assert.deepEqual(result.notices, []);
  });

  test("a trusted project whose extension has a changed file is refused", async () => {
    const root = project();
    await pinProjectExtensions(root);
    writeFileSync(join(folderOf(root), "lib", "v.mjs"), 'export const v = "evil";\n');
    await assert.rejects(load(root), mismatch);
  });

  test("an extension the lock file does not list is refused", async () => {
    const root = project();
    await pinProjectExtensions(root);
    const second = join(root, ".agents", "extensions", "other");
    mkdirSync(second);
    writeFileSync(join(second, "index.mjs"), 'export default { name: "other", version: "1.0.0" };\n');
    await assert.rejects(load(root), mismatch);
  });

  test("a lock file that is not version 1 is refused", async () => {
    const root = project();
    const file = join(root, ".agents", "extensions.lock.json");
    writeFileSync(file, JSON.stringify({ version: 2, extensions: {} }));
    await assert.rejects(
      readLock(file),
      (error: unknown) => isHarnessError(error) && error.code === "invalid_extension",
    );
  });
});
