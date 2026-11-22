// Project trust gates loading: untrusted and headless runs skip with a notice, a trusted one loads.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isHarnessError } from "@buildanagent/harness";
import { memoryTrustStore } from "@buildanagent/harness/extensions";
import { fileTrustStore, loadProjectExtensions } from "@buildanagent/harness/extensions/node";
import { afterAll, describe, test } from "vitest";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A project with one extension folder, `denier`, that gates every call with a deny. */
export function project(body = 'return { decision: "deny", reason: "no" };'): string {
  const root = mkdtempSync(join(tmpdir(), "harness-project-"));
  dirs.push(root);
  const folder = join(root, ".agents", "extensions", "denier");
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "index.mjs"),
    `export default { name: "denier", version: "1.0.0", interceptors: { beforeToolCall() { ${body} } } };\n`,
  );
  return root;
}

describe("loadProjectExtensions", () => {
  test("a project that is not trusted does not load, and says why", async () => {
    const root = project();
    const result = await loadProjectExtensions(root, { trust: memoryTrustStore(), headless: false });
    assert.equal(result.extensions.length, 0);
    assert.match(result.notices[0] ?? "", /not trusted/);
  });

  test("a trusted project loads its extension and records its hash", async () => {
    const root = project();
    const result = await loadProjectExtensions(root, { trust: memoryTrustStore([root]), headless: false });
    assert.deepEqual(
      result.extensions.map((e) => e.name),
      ["denier"],
    );
    assert.equal(result.records[0]?.tier, "in_process");
    assert.match(result.records[0]?.contentHash ?? "", /^sha256:[0-9a-f]{64}$/);
    // With no lock file the extension loads, and a notice says it is unpinned.
    assert.match(result.notices[0] ?? "", /not pinned/);
  });

  test("a headless run skips project extensions by default, even in a trusted project", async () => {
    const root = project();
    const result = await loadProjectExtensions(root, { trust: memoryTrustStore([root]), headless: true });
    assert.equal(result.extensions.length, 0);
    assert.match(result.notices[0] ?? "", /headless/);
  });

  test("a headless run loads a trusted project's extensions only when told to", async () => {
    const root = project();
    const trusted = await loadProjectExtensions(root, {
      trust: memoryTrustStore([root]),
      headless: true,
      loadInHeadless: true,
    });
    assert.equal(trusted.extensions.length, 1);
    const untrusted = await loadProjectExtensions(root, {
      trust: memoryTrustStore(),
      headless: true,
      loadInHeadless: true,
    });
    assert.equal(untrusted.extensions.length, 0);
  });

  test("a project with no extensions loads nothing and says nothing", async () => {
    const root = mkdtempSync(join(tmpdir(), "harness-project-"));
    dirs.push(root);
    const result = await loadProjectExtensions(root, { trust: memoryTrustStore(), headless: false });
    assert.deepEqual(result, { extensions: [], records: [], notices: [] });
  });

  test("a loaded extension's gate denies", async () => {
    const root = project();
    const result = await loadProjectExtensions(root, { trust: memoryTrustStore([root]), headless: false });
    const decision = await result.extensions[0]?.interceptors?.beforeToolCall?.({} as never);
    assert.equal(decision?.decision, "deny");
  });
});

describe("fileTrustStore", () => {
  test("a trusted folder is remembered in a file only its owner can read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-trust-"));
    dirs.push(dir);
    const file = join(dir, "trust.json");
    const store = fileTrustStore(file);
    assert.equal(await store.isTrusted("/work/app"), false);
    await store.trust("/work/app");
    assert.equal(await fileTrustStore(file).isTrusted("/work/app"), true);
    assert.equal(await store.isTrusted("/work/other"), false);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { trusted: ["/work/app"] });
    assert.equal(statSync(file).mode & 0o077, 0);
  });

  test("a symlinked root and its target are one project", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-trust-"));
    dirs.push(dir);
    const real = join(dir, "real");
    mkdirSync(real);
    symlinkSync(real, join(dir, "link"));
    const store = fileTrustStore(join(dir, "trust.json"));
    await store.trust(real);
    assert.equal(await store.isTrusted(join(dir, "link")), true);
  });

  test("a trust file that is not valid JSON is refused as invalid_extension", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-trust-"));
    dirs.push(dir);
    const file = join(dir, "trust.json");
    writeFileSync(file, "{ nope");
    await assert.rejects(
      fileTrustStore(file).isTrusted("/work"),
      (error: unknown) => isHarnessError(error) && error.code === "invalid_extension",
    );
  });

  test("an untrusted project with a corrupt lock file loads nothing and says why, without reading the lock", async () => {
    const root = project();
    writeFileSync(join(root, ".agents", "extensions.lock.json"), "{ not json");
    const result = await loadProjectExtensions(root, { trust: memoryTrustStore(), headless: false });
    assert.equal(result.extensions.length, 0);
    assert.match(result.notices[0] ?? "", /not trusted/);
  });

  test("concurrent trust() calls do not lose an addition", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-trust-"));
    dirs.push(dir);
    const file = join(dir, "trust.json");
    const store = fileTrustStore(file);
    await Promise.all(["/work/a", "/work/b", "/work/c"].map((root) => store.trust(root)));
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).trusted, ["/work/a", "/work/b", "/work/c"]);
  });

  test("a trust file that others may write is refused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-trust-"));
    dirs.push(dir);
    const file = join(dir, "trust.json");
    writeFileSync(file, '{"trusted":[]}', { mode: 0o666 });
    chmodSync(file, 0o666);
    await assert.rejects(
      fileTrustStore(file).isTrusted("/work"),
      (error: unknown) => isHarnessError(error) && error.code === "invalid_extension",
    );
  });
});
