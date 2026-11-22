// Content-hash pins: a changed, added or unlisted extension is refused.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isHarnessError } from "@buildanagent/harness";
import {
  hashExtensionDir,
  loadProjectExtensions,
  pinProjectExtensions,
  readLock,
  realPathTrustStore,
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
const load = (root: string) => loadProjectExtensions(root, { trust: realPathTrustStore([root]), headless: false });
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

  test("a refused project runs none of its extensions: every folder is checked before any is imported", async () => {
    const root = project();
    const marker = `__ran_${Math.random().toString(36).slice(2)}`;
    const second = join(root, ".agents", "extensions", "zeta");
    mkdirSync(second);
    writeFileSync(join(second, "index.mjs"), 'export default { name: "zeta", version: "1.0.0" };\n');
    // `audit` sorts first and would set the marker when imported.
    writeFileSync(
      join(folderOf(root), "index.mjs"),
      `globalThis.${marker} = true;\nexport default { name: "audit", version: "1.0.0" };\n`,
    );
    await pinProjectExtensions(root);
    writeFileSync(join(second, "index.mjs"), 'export default { name: "zeta", version: "evil" };\n');
    await assert.rejects(load(root), mismatch);
    assert.equal((globalThis as Record<string, unknown>)[marker], undefined);
  });

  test("a pinned extension whose folder is gone is refused", async () => {
    const root = project();
    await pinProjectExtensions(root);
    rmSync(folderOf(root), { recursive: true });
    await assert.rejects(load(root), mismatch);
  });

  test("an extension folder with a symlink in it cannot be hashed", async () => {
    const root = project();
    symlinkSync("/etc/hostname", join(folderOf(root), "lib", "link.mjs"));
    await assert.rejects(
      hashExtensionDir(folderOf(root)),
      (error: unknown) => isHarnessError(error) && error.code === "invalid_extension",
    );
  });

  test("a folder that changed after this process loaded it is refused, because Node would run the cached code", async () => {
    const root = project();
    await pinProjectExtensions(root);
    assert.equal((await load(root)).extensions[0]?.version, "1.0.0");
    assert.equal((await load(root)).extensions[0]?.version, "1.0.0");
    writeFileSync(join(folderOf(root), "lib", "v.mjs"), 'export const v = "2.0.0";\n');
    await pinProjectExtensions(root);
    await assert.rejects(load(root), mismatch);
  });

  test("a lock file that is not an object, or not JSON, is refused as invalid_extension", async () => {
    const root = project();
    const file = join(root, ".agents", "extensions.lock.json");
    for (const text of ["null", "{ not json", "[1]"]) {
      writeFileSync(file, text);
      await assert.rejects(
        readLock(file),
        (error: unknown) => isHarnessError(error) && error.code === "invalid_extension",
      );
    }
  });

  test("pinning creates the lock file's folder", async () => {
    const root = project();
    const lockFile = join(root, "locks", "deep", "extensions.lock.json");
    await pinProjectExtensions(root, { lockFile });
    assert.ok(existsSync(lockFile));
  });

  test("a changed folder is refused before any other folder of the project is imported", async () => {
    const root = project();
    const marker = `__ran2_${Math.random().toString(36).slice(2)}`;
    const second = join(root, ".agents", "extensions", "zeta");
    mkdirSync(second);
    writeFileSync(join(second, "index.mjs"), 'export default { name: "zeta", version: "1.0.0" };\n');
    await pinProjectExtensions(root);
    await load(root);
    // Both folders are now imported. Change `zeta`, re-pin, and put a marker in `audit` that a re-import would not run.
    writeFileSync(join(second, "index.mjs"), 'export default { name: "zeta", version: "2.0.0" };\n');
    writeFileSync(
      join(folderOf(root), "index.mjs"),
      `globalThis.${marker} = true;\nexport default { name: "audit", version: "1.0.0" };\n`,
    );
    await pinProjectExtensions(root);
    await assert.rejects(load(root), mismatch);
    assert.equal((globalThis as Record<string, unknown>)[marker], undefined);
  });

  test("a symlinked extension folder is refused", async () => {
    const root = project();
    symlinkSync(folderOf(root), join(root, ".agents", "extensions", "alias"));
    await assert.rejects(load(root), (error: unknown) => isHarnessError(error) && error.code === "invalid_extension");
  });

  test("an extension whose exports are not the right shape is refused as invalid_extension", async () => {
    for (const body of [
      'export default { name: "x", version: "1", observers: "nope" };',
      'export default { name: "x", version: "1", interceptors: { beforeToolCall: 5 } };',
      'export default { name: "x", version: "1", tools: 5 };',
      'export default { name: "x", version: "1", tools: [{ name: "t", definition: null }] };',
    ]) {
      const root = project();
      writeFileSync(join(folderOf(root), "index.mjs"), `${body}\n`);
      await assert.rejects(load(root), (error: unknown) => isHarnessError(error) && error.code === "invalid_extension");
    }
  });
});
