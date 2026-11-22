// The memory tool's paths: a path that leaves `.agents/memory/`, spelled plainly, percent-encoded or through a link,
// returns an error result and reads nothing, and a rename can't move a record out of the folder.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isHarnessError } from "@buildanagent/harness";
import { fileMemoryFiles } from "@buildanagent/harness/memory/node";
import { describe, test } from "vitest";
import { memoryBackend } from "../session/memory-backend.js";
import { counted, project, results, type Setup, tempDir, testClock, turn } from "./helpers.js";

const SECRET = "DATABASE_PASSWORD=correct horse battery staple";
const key = { userId: "ada", sessionId: "s1" };
const view = (path: string) => ({ name: "memory", input: { command: "view", path } });

function setupWith(root: string) {
  const backend = memoryBackend();
  const store = counted(fileMemoryFiles(root));
  const setup: Setup = { root, files: store.files, clock: testClock().now, ...backend };
  return { setup, calls: store.calls };
}

/** A project whose memory folder holds one record, with a secrets file beside the folder. */
function seeded() {
  const root = project();
  mkdirSync(join(root, ".agents/memory"), { recursive: true });
  writeFileSync(join(root, ".agents/secrets.env"), SECRET);
  writeFileSync(join(root, "secrets.env"), SECRET);
  return root;
}

const create = (path: string) => ({
  name: "memory",
  input: { command: "create", path, subject: "S", fact: "A fact.", source: "user", type: "project" },
});

describe("a path that leaves the memory folder", () => {
  test("a view of .agents/memory/../secrets.env, plain or percent-encoded, returns an error result and reads nothing", async () => {
    const root = seeded();
    const { setup, calls } = setupWith(root);
    const paths = [
      ".agents/memory/../secrets.env",
      ".agents/memory/%2e%2e/secrets.env",
      ".agents/memory/%2E%2E%2Fsecrets.env",
      ".agents/memory/..%2fsecrets.env",
      `${root}/.agents/memory/../../secrets.env`,
      "/etc/passwd",
      ".agents/memory/./build.md",
      ".agents/memory//build.md",
      ".agents/memory/.calls.json",
      ".agents/memory\\..\\secrets.env",
    ];
    const run = await turn(setup, key, paths.map(view));
    for (const [at, path] of paths.entries()) {
      const result = results(run.model).get(`c${at + 1}`);
      assert.equal(result?.isError, true, path);
      assert.ok(!result?.text.includes("correct horse"), path);
    }
    assert.deepEqual(
      calls.filter((call) => call.startsWith("read")),
      [],
      "no path reached the file store",
    );
  });

  test("a create or a rename to a path outside the folder is refused and leaves every file where it was", async () => {
    const root = seeded();
    const { setup } = setupWith(root);
    const run = await turn(setup, key, [
      create(".agents/memory/keep.md"),
      create(".agents/rules.md"),
      create("AGENTS.md"),
      {
        name: "memory",
        input: { command: "rename", old_path: ".agents/memory/keep.md", new_path: ".agents/memory/../moved.md" },
      },
      {
        name: "memory",
        input: { command: "rename", old_path: ".agents/memory/keep.md", new_path: `${root}/moved.md` },
      },
      {
        name: "memory",
        input: { command: "rename", old_path: ".agents/memory/keep.md", new_path: ".agents/memory/%2e%2e/moved.md" },
      },
      { name: "memory", input: { command: "delete", path: ".agents/memory" } },
      { name: "memory", input: { command: "rename", old_path: ".agents/memory/", new_path: ".agents/memory/x.md" } },
    ]);
    assert.equal(results(run.model).get("c1")?.isError, false);
    for (const id of ["c2", "c3", "c4", "c5", "c6", "c7", "c8"])
      assert.equal(results(run.model).get(id)?.isError, true, id);
    assert.ok(existsSync(join(root, ".agents/memory/keep.md")));
    assert.ok(!existsSync(join(root, "moved.md")) && !existsSync(join(root, ".agents/moved.md")));
    assert.ok(!existsSync(join(root, ".agents/rules.md")) && !existsSync(join(root, "AGENTS.md")));
  });

  test("a rename inside the folder moves the record and refuses to replace another", async () => {
    const root = seeded();
    const { setup } = setupWith(root);
    const run = await turn(setup, key, [
      create(".agents/memory/a.md"),
      create(".agents/memory/b.md"),
      {
        name: "memory",
        input: { command: "rename", old_path: ".agents/memory/a.md", new_path: ".agents/memory/b.md" },
      },
      {
        name: "memory",
        input: { command: "rename", old_path: ".agents/memory/a.md", new_path: ".agents/memory/done/a.md" },
      },
    ]);
    assert.equal(results(run.model).get("c3")?.isError, true);
    assert.equal(results(run.model).get("c4")?.isError, false);
    assert.ok(existsSync(join(root, ".agents/memory/done/a.md")) && !existsSync(join(root, ".agents/memory/a.md")));
  });
});

describe("links", () => {
  test("a record that is a link to a file outside the folder is neither viewed nor listed", async () => {
    const root = seeded();
    const outside = tempDir();
    writeFileSync(join(outside, "id_rsa"), SECRET);
    symlinkSync(join(outside, "id_rsa"), join(root, ".agents/memory/key.md"));
    const { setup } = setupWith(root);
    const run = await turn(setup, key, [view(".agents/memory/key.md"), view(".agents/memory")]);
    const first = results(run.model).get("c1");
    assert.equal(first?.isError, true);
    assert.ok(first?.text.includes("link") && !first.text.includes("correct horse"));
    assert.ok(results(run.model).get("c2")?.text.includes("holds no records"));
  });

  test("a write through a link is refused, so nothing is written outside the folder", async () => {
    const root = seeded();
    const outside = tempDir();
    writeFileSync(join(outside, "target.md"), "untouched");
    symlinkSync(join(outside, "target.md"), join(root, ".agents/memory/over.md"));
    mkdirSync(join(outside, "dir"));
    symlinkSync(join(outside, "dir"), join(root, ".agents/memory/linked"));
    const { setup } = setupWith(root);
    const run = await turn(setup, key, [create(".agents/memory/over.md"), create(".agents/memory/linked/new.md")]);
    assert.equal(results(run.model).get("c1")?.isError, true);
    assert.equal(results(run.model).get("c2")?.isError, true);
    assert.equal(readFileSync(join(outside, "target.md"), "utf8"), "untouched");
    assert.ok(!existsSync(join(outside, "dir/new.md")));
  });

  test("a memory folder that is itself a link, or under a linked .agents, is refused", async () => {
    const root = project();
    const outside = tempDir();
    symlinkSync(outside, join(root, ".agents"));
    const { setup } = setupWith(root);
    const run = await turn(setup, key, [create(".agents/memory/new.md")]);
    assert.equal(results(run.model).get("c1")?.isError, true);
    assert.ok(!existsSync(join(outside, "memory")));
  });

  test("the file store refuses a name the tool's check would refuse, whoever calls it", async () => {
    const files = fileMemoryFiles(project());
    for (const name of ["../x.md", "a/../../x.md", "", "/etc/passwd", ".hidden.md"]) {
      await assert.rejects(
        files.write(name, "x"),
        (error) => isHarnessError(error) && error.code === "memory_path_refused",
        name,
      );
    }
    assert.throws(
      () => fileMemoryFiles("relative/root"),
      (error) => isHarnessError(error) && error.code === "invalid_memory_options",
    );
  });
});
