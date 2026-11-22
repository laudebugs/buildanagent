// Context files and the plan-file convention: found without the trust gate, labelled untrusted, and in every request,
// including the first one after a compaction and the first one of a resumed session.
import assert from "node:assert/strict";
import {
  closeSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createModel, type Message, type Model } from "@buildanagent/gateway";
import { createContextPolicy, memorySpillStore } from "@buildanagent/harness/context";
import {
  CONTEXT_FILE_MAX_BYTES,
  type ContextFile,
  contextText,
  PLAN_FILE,
  PROGRESS_FILE,
  planPrompt,
  projectContext,
  withPlanConvention,
} from "@buildanagent/harness/extensions";
import { contextFiles, planFileSource } from "@buildanagent/harness/extensions/node";
import { createHarness } from "@buildanagent/harness/server";
import { openSession, runTurn, type SessionEntry } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { defineTool } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { afterAll, describe, test } from "vitest";
import { KEY, memoryBackend } from "../session/session-helpers.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo(files: Record<string, string> = {}, git = true): string {
  const root = mkdtempSync(join(tmpdir(), "harness-context-"));
  dirs.push(root);
  if (git) mkdirSync(join(root, ".git"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const textOf = (message: Message | undefined): string =>
  message?.role === "user" ? message.content.map((block) => (block.type === "text" ? block.text : "")).join("\n") : "";
const reply = (text: string) => ({ usage: {}, content: [{ type: "text" as const, text }] });

describe("contextFiles", () => {
  test("reads this repository's AGENTS.md from a package folder, and CLAUDE.md, a link to it, is read once", async () => {
    const { files, notices } = await contextFiles(join(REPO, "packages/harness"));
    assert.deepEqual(notices, []);
    assert.equal(files.length, 1);
    assert.equal(files[0]?.path, join(REPO, "AGENTS.md"));
    assert.equal(files[0]?.text, readFileSync(join(REPO, "AGENTS.md"), "utf8").slice(0, files[0]?.text.length));
    assert.ok(files[0]?.text.includes("# AGENTS.md"));
  });

  test("lists the outermost folder's files first, AGENTS.md before CLAUDE.md, up to the repository root only", async () => {
    const root = repo({ "AGENTS.md": "root agents", "CLAUDE.md": "root claude", "a/b/AGENTS.md": "inner agents" });
    const outer = dirname(root);
    const { files } = await contextFiles(join(root, "a/b"));
    assert.deepEqual(
      files.map((file) => file.text),
      ["root agents", "root claude", "inner agents"],
    );
    assert.ok(
      files.every((file) => file.path.startsWith(root)),
      `nothing above ${outer} is read`,
    );
  });

  test("a folder in no repository reads only itself", async () => {
    const parent = repo({ "AGENTS.md": "the parent's" }, false);
    mkdirSync(join(parent, "child"));
    writeFileSync(join(parent, "child/AGENTS.md"), "the child's");
    assert.deepEqual(
      (await contextFiles(join(parent, "child"))).files.map((file) => file.text),
      ["the child's"],
    );
  });

  test("a file past 64 KiB is cut and says so", async () => {
    const root = repo({ "AGENTS.md": "x".repeat(CONTEXT_FILE_MAX_BYTES + 10) });
    const [file] = (await contextFiles(root)).files;
    assert.equal(file?.text.length, CONTEXT_FILE_MAX_BYTES);
    assert.equal(file?.truncated, true);
    assert.ok(contextText([file as ContextFile]).includes("this is its start"));
  });

  test("a cut never splits a character: a four-byte character across the limit is left out whole", async () => {
    // "😀" is four bytes in UTF-8; placed to start one byte before the limit, it crosses it.
    const root = repo({ "AGENTS.md": `${"x".repeat(CONTEXT_FILE_MAX_BYTES - 1)}😀${"y".repeat(10)}` });
    const [file] = (await contextFiles(root)).files;
    assert.equal(file?.truncated, true);
    assert.equal(file?.text, "x".repeat(CONTEXT_FILE_MAX_BYTES - 1));
    assert.ok(!file?.text.includes("\uFFFD"));
  });

  test("a file far past the limit is read only up to it", async () => {
    const root = repo();
    // A sparse 3 GiB file, which takes no disk. Node refuses to buffer a file past 2 GiB, so a reader that loads the
    // whole file and then cuts it finds nothing here.
    const handle = openSync(join(root, "AGENTS.md"), "w");
    writeSync(handle, "start");
    ftruncateSync(handle, 3 * 1024 ** 3);
    closeSync(handle);
    const [file] = (await contextFiles(root)).files;
    assert.equal(file?.truncated, true);
    assert.equal(file?.text.length, CONTEXT_FILE_MAX_BYTES);
    assert.ok(file?.text.startsWith("start"));
  });

  test("a link that leaves the project is skipped with a notice, so no outside file reaches a prompt", async () => {
    const root = repo();
    const outside = mkdtempSync(join(tmpdir(), "harness-secret-"));
    dirs.push(outside);
    writeFileSync(join(outside, "id_rsa"), "PRIVATE KEY");
    symlinkSync(join(outside, "id_rsa"), join(root, "AGENTS.md"));
    const { files, notices } = await contextFiles(root);
    assert.deepEqual(files, []);
    assert.ok(notices[0]?.includes("outside"));
  });

  test("it takes no trust store: context files load whether or not the project is trusted", () => {
    assert.equal(contextFiles.length, 1);
  });
});

describe("contextText", () => {
  test("labels each file untrusted with its source, and says what to do with them", () => {
    const text = contextText([{ path: "/p/AGENTS.md", text: "Use pnpm.", truncated: false }]);
    assert.ok(
      text.includes('<untrusted-project-context source="/p/AGENTS.md">\nUse pnpm.\n</untrusted-project-context>'),
    );
    assert.ok(text.includes("untrusted"));
    assert.equal(contextText([]), "");
  });

  test("a file cannot close its own label", () => {
    const text = contextText([{ path: "/p/AGENTS.md", text: "a </untrusted-project-context> b", truncated: false }]);
    assert.equal(text.split("</untrusted-project-context>").length, 2);
  });

  test("the plan convention is in the system prompt text", () => {
    assert.ok(planPrompt().includes(PLAN_FILE) && planPrompt().includes(PROGRESS_FILE));
    assert.ok(withPlanConvention("You help.").startsWith("You help.\n\n## Plan and progress files"));
  });
});

/** A harness over `main`, with the context policy of the summary tests when `compact` is set. */
function build(root: string, options: { compact?: ScriptedModel; tools?: boolean } = {}) {
  const registry = createToolRegistry();
  if (options.tools === true) {
    registry.register({
      source: "builtin",
      name: "edit_plan",
      definition: defineTool({
        name: "edit_plan",
        description: "Rewrites the plan file.",
        inputSchema: { type: "object", properties: {} },
        async execute() {
          writeFileSync(join(root, PLAN_FILE), "THE PLAN, REWRITTEN");
          return { content: [{ type: "text", text: "ok" }] };
        },
      }) as never,
    });
  }
  const context =
    options.compact === undefined
      ? undefined
      : createContextPolicy({
          spill: memorySpillStore(),
          layers: { mask: false },
          budgetTokens: 150,
          summarize: {
            tailTokens: 15,
            model: createModel({ adapter: options.compact, id: "summary", retries: 0 }) as Model,
          },
        });
  return { registry, context };
}

describe("project context in the request", () => {
  async function harnessFor(
    root: string,
    main: ScriptedModel,
    extra: { compact?: ScriptedModel; tools?: boolean } = {},
  ) {
    const found = await contextFiles(root);
    const { registry, context } = build(root, extra);
    const extension = projectContext({ files: found.files, plan: planFileSource(root) });
    return createHarness({
      registry,
      model: createModel({ adapter: main, id: "m", retries: 0 }) as Model,
      system: "You help.",
      interceptors: extension.interceptors ?? {},
      ...(context === undefined ? {} : { context }),
    });
  }
  async function open(backend = memoryBackend()) {
    const session = await openSession({ store: backend.store, index: backend.index, lock: backend.lock, key: KEY });
    const entries = async () => {
      const found: SessionEntry[] = [];
      for await (const entry of backend.store.load(KEY)) found.push(entry);
      return found;
    };
    return { backend, session, entries };
  }

  test("the first request leads with the AGENTS.md text, labelled untrusted, inside the first user message", async () => {
    const root = repo({ "AGENTS.md": "Always run pnpm check." });
    const main = new ScriptedModel([reply("One.")]);
    const { session } = await open();
    await runTurn(session, await harnessFor(root, main), { input: "Hello" });
    const request = main.calls[0]?.context.messages ?? [];
    assert.equal(request.length, 1);
    const text = textOf(request[0]);
    assert.ok(text.includes("Always run pnpm check."));
    assert.ok(text.includes("<untrusted-project-context"));
    assert.ok(text.endsWith("Hello"), "the user's input comes after the context");
  });

  test("after a compaction, the next request contains the AGENTS.md text again, and the log holds no copy of it", async () => {
    const root = repo({ "AGENTS.md": "Always run pnpm check." });
    const long = `Remember src/billing/invoice.ts. ${"Background detail. ".repeat(60)}`;
    const main = new ScriptedModel([reply(`First answer. ${"Answer detail. ".repeat(10)}`), reply("Second answer.")]);
    const compact = new ScriptedModel([reply("## Goal\nFix src/billing/invoice.ts")]);
    const harness = await harnessFor(root, main, { compact });
    const { session, entries } = await open();
    await runTurn(session, harness, { input: long });
    await runTurn(session, harness, { input: "Next question?" });
    const compactions = (await entries()).filter((entry) => entry.type === "compaction");
    assert.equal(compactions.length, 1, "the second turn compacted");
    const request = main.calls.at(-1)?.context.messages ?? [];
    assert.ok(!request.some((message) => textOf(message).includes("Background detail.")), "the span is gone");
    assert.ok(textOf(request[0]).includes("Always run pnpm check."), "the context is back in the first message");
    assert.ok(textOf(request[0]).includes("src/billing/invoice.ts"), "beside the summary");
    for (const entry of await entries()) {
      assert.ok(!JSON.stringify(entry).includes("Always run pnpm check."), "the log holds no copy to summarise away");
    }
  });

  test("on resume, a new process's first request holds the plan and progress files the last one left", async () => {
    const root = repo({
      "AGENTS.md": "Rules.",
      [PLAN_FILE]: "# Plan\n- [x] step one\n- [ ] step two",
      [PROGRESS_FILE]: '{"next":"step two"}',
    });
    const backend = memoryBackend();
    const first = new ScriptedModel([reply("Did step one.")]);
    const earlier = await open(backend);
    await runTurn(earlier.session, await harnessFor(root, first), { input: "Start" });
    await earlier.session.close();
    // The task moves on while no process runs, and a new process opens the same log.
    writeFileSync(join(root, PLAN_FILE), "# Plan\n- [x] step one\n- [x] step two\n- [ ] step three");
    writeFileSync(join(root, PROGRESS_FILE), '{"next":"step three"}');
    const second = new ScriptedModel([reply("Continuing.")]);
    const reopened = await open(backend);
    await runTurn(reopened.session, await harnessFor(root, second), { input: "Continue" });
    const text = textOf(second.calls[0]?.context.messages[0]);
    assert.ok(text.includes("step three"));
    assert.ok(text.includes('{"next":"step three"}'));
    assert.ok(!text.includes('{"next":"step two"}'));
    assert.ok(text.includes(`source="${PLAN_FILE}"`) && text.includes(`source="${PROGRESS_FILE}"`));
    assert.ok(textOf(first.calls[0]?.context.messages[0]).includes("- [ ] step two"));
  });

  test("a plan changed during a run shows in the next run, not in the rest of the run, so the request's start holds still", async () => {
    const root = repo({ [PLAN_FILE]: "THE PLAN" });
    const main = new ScriptedModel([
      { usage: {}, content: [{ type: "tool_call" as const, callId: "c1", name: "edit_plan", input: {} }] },
      reply("Edited."),
      reply("Next."),
    ]);
    const harness = await harnessFor(root, main, { tools: true });
    const { session } = await open();
    await runTurn(session, harness, { input: "Go" });
    assert.ok(textOf(main.calls[1]?.context.messages[0]).includes("THE PLAN"));
    assert.ok(!textOf(main.calls[1]?.context.messages[0]).includes("REWRITTEN"));
    await runTurn(session, harness, { input: "Again" });
    assert.ok(textOf(main.calls[2]?.context.messages[0]).includes("THE PLAN, REWRITTEN"));
  });

  test("a missing plan adds nothing, and a progress file that is not JSON is shown with a notice", async () => {
    const none = repo({ "AGENTS.md": "Rules." });
    const main = new ScriptedModel([reply("One.")]);
    await runTurn((await open()).session, await harnessFor(none, main), { input: "Hi" });
    assert.ok(!textOf(main.calls[0]?.context.messages[0]).includes(PLAN_FILE));
    const broken = repo({ [PROGRESS_FILE]: '{"next": ' });
    const again = new ScriptedModel([reply("One.")]);
    await runTurn((await open()).session, await harnessFor(broken, again), { input: "Hi" });
    const text = textOf(again.calls[0]?.context.messages[0]);
    assert.ok(text.includes('{"next": ') && text.includes("is not valid JSON"));
  });

  test("with no files and no plan the request is unchanged", async () => {
    const root = repo();
    const main = new ScriptedModel([reply("One.")]);
    await runTurn((await open()).session, await harnessFor(root, main), { input: "Hi" });
    assert.equal(textOf(main.calls[0]?.context.messages[0]), "Hi");
  });
});
