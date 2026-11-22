// The built-in tools reach files, commands and the web only through the sandbox and the egress proxy, check every
// path before the sandbox sees it, and hand big results to the write cap. Every test runs on fakeSandbox(), so no
// tool call touches a host file or process.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalInputHash } from "@buildanagent/agent-safety";
import { createModel, type Model } from "@buildanagent/gateway";
import { HarnessError, isHarnessError } from "@buildanagent/harness";
import { createContextPolicy, memorySpillStore } from "@buildanagent/harness/context";
import { fileSpillStore } from "@buildanagent/harness/context/file";
import { type EgressRecord, startEgressProxy } from "@buildanagent/harness/credentials";
import type { ExecResult, Sandbox, SandboxPolicy } from "@buildanagent/harness/sandbox";
import { createHarness } from "@buildanagent/harness/server";
import { openSession, runTurn, type SessionEntry } from "@buildanagent/harness/session";
import { fakeSandbox } from "@buildanagent/harness/testing";
import {
  BUILTIN_TOOL_DEFAULTS,
  BUILTIN_TOOLS_HASH,
  type BuiltinToolsOptions,
  builtinTools,
  createToolRegistry,
  type FetchProxy,
} from "@buildanagent/harness/tools";
import type { ToolContext, ToolDefinition, ToolResult } from "@buildanagent/sdk";
import { type RecordedRequest, ScriptedModel, type ScriptStep } from "@buildanagent/sdk/testing";
import { describe, test } from "vitest";
import { KEY, memoryBackend } from "../session/session-helpers.js";

const ROOT = "/work";
const POLICY: SandboxPolicy = { readRoots: ["/docs"], writeRoots: [ROOT], network: { allow: [], deny: [] } };
const FILES = {
  "notes.md": "alpha\nbeta\nalpha beta\n",
  "src/app.ts": "export const answer = 42;\n",
  "src/deep/util.ts": "// TODO: tidy\nexport const two = 2;\n",
  "node_modules/dep/index.ts": "export const answer = 0;\n",
  "../docs/guide.md": "read me\n",
  "../etc/passwd": "root:x:0:0\n",
};
const decoder = new TextDecoder();

/** A sandbox that counts the calls it passes on, so a test can show a refused path never reached it. */
function counting(sandbox: Sandbox): Sandbox & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    exec(command, options) {
      calls.push(`exec ${command[0]}`);
      return sandbox.exec(command, options);
    },
    readFile(path) {
      calls.push(`read ${path}`);
      return sandbox.readFile(path);
    },
    writeFile(path, data) {
      calls.push(`write ${path}`);
      return sandbox.writeFile(path, data);
    },
    dispose: () => sandbox.dispose(),
  };
}

async function setup(
  options: Partial<BuiltinToolsOptions> = {},
  proxy?: FetchProxy,
  files: Record<string, string | Uint8Array> = FILES,
) {
  const client = fakeSandbox();
  const sandbox = counting(await client.provision({ root: ROOT, files }, POLICY));
  const tools = builtinTools(sandbox, proxy, { root: ROOT, policy: POLICY, ...options });
  const tool = (name: string): ToolDefinition<unknown, unknown, unknown> => {
    const found = tools.find((entry) => entry.name === name);
    assert.ok(found, `no ${name} tool`);
    return found.definition;
  };
  return { client, sandbox, tools, tool };
}

const context = (): ToolContext =>
  ({ runId: "r1", callId: "c1", signal: new AbortController().signal, depth: 0, maxDepth: 2 }) as ToolContext;
const call = (tool: ToolDefinition<unknown, unknown, unknown>, input: unknown): Promise<ToolResult> =>
  tool.execute(input, context());
const textOf = (result: ToolResult): string =>
  result.content.map((block) => (block.type === "text" ? block.text : "")).join("");
const fileText = (client: ReturnType<typeof fakeSandbox>, path: string): string | undefined => {
  const data = client.files().get(path);
  return data === undefined ? undefined : decoder.decode(data);
};

/** Runs one turn of a harness whose registry holds the built-in tools, on a scripted model. */
async function runTools(
  steps: ScriptStep[],
  tools: ReturnType<typeof builtinTools>,
  harnessContext?: Parameters<typeof createHarness>[0]["context"],
) {
  const adapter = new ScriptedModel(steps);
  const model = createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
  const registry = createToolRegistry();
  for (const tool of tools) registry.register(tool);
  const harness = createHarness({
    registry,
    model,
    system: "You work in the sandbox.",
    ...(harnessContext === undefined ? {} : { context: harnessContext }),
  });
  const backend = memoryBackend();
  const session = await openSession({ store: backend.store, index: backend.index, lock: backend.lock, key: KEY });
  const result = await runTurn(session, harness, { input: "Do the task." });
  const entries: SessionEntry[] = [];
  for await (const entry of backend.store.load(KEY)) entries.push(entry);
  return { adapter, entries, result };
}

const toolCall = (name: string, input: unknown, callId = "c1"): ScriptStep => ({
  content: [{ type: "tool_call", callId, name, input }],
});
const done: ScriptStep = { content: [{ type: "text", text: "Done." }] };
const results = (entries: readonly SessionEntry[]) =>
  entries.filter((entry): entry is Extract<SessionEntry, { type: "tool_result" }> => entry.type === "tool_result");
const entryText = (entry: Extract<SessionEntry, { type: "tool_result" }>): string =>
  entry.content.map((block) => (block.type === "text" ? block.text : "")).join("");

describe("bash", () => {
  test("with fakeSandbox(), a scripted model's bash call records the command and touches no host file", async () => {
    const hostFile = join(tmpdir(), `builtin-bash-${process.pid}-never-written`);
    const { client, tools } = await setup();
    const { entries } = await runTools([toolCall("bash", { command: `touch ${hostFile}` }), done], tools);
    assert.deepEqual(
      client.execs.map((exec) => exec.command),
      [["bash", "-c", `touch ${hostFile}`]],
    );
    assert.equal(client.execs[0]?.timeoutMs, BUILTIN_TOOL_DEFAULTS.bash.defaultTimeoutMs);
    assert.equal(existsSync(hostFile), false);
    const [result] = results(entries);
    assert.ok(result !== undefined && entryText(result).includes("[exit code 127]"));
  });

  test("a command runs with only the environment the host gave it", async () => {
    const { tool } = await setup({ env: { PATH: "/bin", HOME: "/tmp/home" } });
    const result = await call(tool("bash"), { command: "env" });
    assert.equal(textOf(result), "PATH=/bin\nHOME=/tmp/home\n\n[exit code 0]");
  });

  test("a command that runs past its timeout stops with an error result", async () => {
    const { client, tool } = await setup();
    const result = await call(tool("bash"), { command: "sleep 5", timeout_ms: 20 });
    assert.equal(result.isError, true);
    assert.deepEqual(result.details, { exitCode: 124, timedOut: true });
    assert.match(textOf(result), /\[timed out after 20 ms\]/);
    assert.equal(client.execs[0]?.timeoutMs, 20);
  });

  test("a command that exits with 124 itself is reported by its exit code, not as the harness's timeout", async () => {
    const sandbox = await fakeSandbox().provision({ root: ROOT }, POLICY);
    const own: Sandbox = { ...sandbox, exec: async () => ({ exitCode: 124, stdout: "slow\n", stderr: "" }) };
    const [bash] = builtinTools(own, undefined, { root: ROOT, policy: POLICY }).filter((tool) => tool.name === "bash");
    assert.ok(bash !== undefined);
    const result = await call(bash.definition, { command: "timeout 1 sleep 5" });
    assert.equal(result.isError, undefined);
    assert.equal(textOf(result), "slow\n\n[exit code 124]");
  });

  test("a command the network policy stops returns the denial as an error result", async () => {
    const { tool } = await setup();
    const result = await call(tool("bash"), { command: "net-probe exfil.example" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /denied a network of exfil\.example/);
  });
});

describe("edit", () => {
  test("two matches return an error result and change nothing", async () => {
    const { client, tool } = await setup();
    const result = await call(tool("edit"), { path: "notes.md", old_string: "alpha", new_string: "gamma" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /occurs 2 times/);
    assert.equal(fileText(client, "/work/notes.md"), FILES["notes.md"]);
  });

  test("zero matches return an error result and change nothing", async () => {
    const { client, sandbox, tool } = await setup();
    const result = await call(tool("edit"), { path: "notes.md", old_string: "delta", new_string: "gamma" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /does not occur/);
    assert.equal(fileText(client, "/work/notes.md"), FILES["notes.md"]);
    assert.deepEqual(sandbox.calls, ["read /work/notes.md"]);
  });

  test("a unique match is replaced, and replacement patterns in new_string stay as written", async () => {
    const { client, tool } = await setup();
    const result = await call(tool("edit"), { file_path: "src/app.ts", old_string: "42", new_string: "$& and $1" });
    assert.equal(result.isError, undefined);
    assert.equal(fileText(client, "/work/src/app.ts"), "export const answer = $& and $1;\n");
  });

  test("replace_all replaces every match", async () => {
    const { client, tool } = await setup();
    const result = await call(tool("edit"), {
      path: "notes.md",
      old_string: "alpha",
      new_string: "gamma",
      replace_all: true,
    });
    assert.equal(textOf(result), "Replaced 2 matches in /work/notes.md.");
    assert.equal(fileText(client, "/work/notes.md"), "gamma\nbeta\ngamma beta\n");
  });

  test("a byte order mark is kept, and a file that is not UTF-8 is refused and left unchanged", async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("a = 1\n")]);
    const latin1 = new Uint8Array([...new TextEncoder().encode("caf"), 0xe9, ...new TextEncoder().encode(" = 1\n")]);
    const { client, tool } = await setup({}, undefined, { "bom.txt": bom, "latin1.txt": latin1 });
    const kept = await call(tool("edit"), { path: "bom.txt", old_string: "1", new_string: "2" });
    assert.equal(kept.isError, undefined);
    const written = client.files().get("/work/bom.txt");
    assert.equal(new TextDecoder("utf-8", { ignoreBOM: true }).decode(written), "\ufeffa = 2\n");
    const refused = await call(tool("edit"), { path: "latin1.txt", old_string: "1", new_string: "2" });
    assert.equal(refused.isError, true);
    assert.match(textOf(refused), /is not UTF-8 text/);
    assert.deepEqual(client.files().get("/work/latin1.txt"), latin1);
  });

  test("a binary file is refused and left unchanged", async () => {
    const blob = new Uint8Array([0x61, 0, 0x31]);
    const { client, tool } = await setup({}, undefined, { "blob.bin": blob });
    const result = await call(tool("edit"), { path: "blob.bin", old_string: "1", new_string: "2" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /is a binary file/);
    assert.deepEqual(client.files().get("/work/blob.bin"), blob);
  });

  test("a missing file is an error result", async () => {
    const { tool } = await setup();
    const result = await call(tool("edit"), { path: "absent.md", old_string: "a", new_string: "b" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /No such file/);
  });
});

describe("write", () => {
  test("a write inside the write roots goes through the sandbox", async () => {
    const { client, sandbox, tool } = await setup();
    const result = await call(tool("write"), { path: "out/new.txt", content: "hello" });
    assert.equal(textOf(result), "Wrote 5 bytes to /work/out/new.txt.");
    assert.equal(fileText(client, "/work/out/new.txt"), "hello");
    assert.deepEqual(sandbox.calls, ["write /work/out/new.txt"]);
  });

  for (const path of ["../etc/evil", "/etc/evil", "/docs/guide.md", "src/../../docs/x", "/work/../etc/evil"]) {
    test(`a write to ${path} is refused before the sandbox is called`, async () => {
      const { client, sandbox, tool } = await setup();
      const before = new Map(client.files());
      const result = await call(tool("write"), { path, content: "x" });
      assert.equal(result.isError, true);
      assert.match(textOf(result), /outside the folders this tool may write/);
      assert.deepEqual(sandbox.calls, []);
      assert.deepEqual(client.files(), before);
    });
  }

  test("a path with a backslash is refused before the sandbox is called, by every file tool", async () => {
    const { client, sandbox, tool } = await setup();
    const before = new Map(client.files());
    const results = [
      await call(tool("write"), { path: "logs\\run.txt", content: "x" }),
      await call(tool("read"), { path: "src\\app.ts" }),
      await call(tool("edit"), { path: "src\\app.ts", old_string: "42", new_string: "43" }),
      await call(tool("grep"), { pattern: "answer", path: "src\\deep" }),
      await call(tool("glob"), { pattern: "*.ts", path: "src\\deep" }),
    ];
    for (const result of results) {
      assert.equal(result.isError, true);
      assert.match(textOf(result), /holds a backslash/);
    }
    assert.deepEqual(sandbox.calls, []);
    assert.deepEqual(client.files(), before);
  });

  test("an edit outside the write roots is refused before the sandbox is called", async () => {
    const { sandbox, tool } = await setup();
    const result = await call(tool("edit"), { path: "/docs/guide.md", old_string: "read", new_string: "x" });
    assert.equal(result.isError, true);
    assert.deepEqual(sandbox.calls, []);
  });

  test("a write through a symlink that leads out of the roots is denied by the sandbox", async () => {
    const { client, tool } = await setup();
    client.symlink("/work/out", "/etc");
    const result = await call(tool("write"), { path: "out/evil", content: "x" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /denied a filesystem write/);
    assert.equal(client.files().has("/etc/evil"), false);
  });
});

describe("read", () => {
  test("a relative path, an absolute one and a read root all read through the sandbox", async () => {
    const { tool } = await setup();
    assert.equal(textOf(await call(tool("read"), { path: "notes.md" })), FILES["notes.md"]);
    assert.equal(textOf(await call(tool("read"), { file_path: "/work/src/app.ts" })), FILES["src/app.ts"]);
    assert.equal(textOf(await call(tool("read"), { path: "/docs/guide.md" })), "read me\n");
  });

  for (const path of ["../etc/passwd", "/etc/passwd", "src/../../etc/passwd"]) {
    test(`a read of ${path} is refused before the sandbox is called`, async () => {
      const { sandbox, tool } = await setup();
      const result = await call(tool("read"), { path });
      assert.equal(result.isError, true);
      assert.match(textOf(result), /outside the folders this tool may read/);
      assert.deepEqual(sandbox.calls, []);
    });
  }

  test("a read through a symlink that leads out of the roots is denied and shows nothing", async () => {
    const { client, tool } = await setup();
    client.symlink("/work/link", "/etc");
    const result = await call(tool("read"), { path: "link/passwd" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /denied a filesystem read/);
    assert.doesNotMatch(textOf(result), /root:x/);
  });

  test("offset and limit return a page and say where to read on", async () => {
    const { sandbox, tool } = await setup();
    const result = await call(tool("read"), { path: "notes.md", offset: 2, limit: 1 });
    assert.equal(textOf(result), "beta\n[lines 2 to 2 of 3; read on with offset 3]");
    const last = await call(tool("read"), { path: "notes.md", offset: 3 });
    assert.equal(textOf(last), "alpha beta\n");
    const past = await call(tool("read"), { path: "notes.md", offset: 9 });
    assert.equal(past.isError, true);
    await sandbox.writeFile("/work/empty.txt", new Uint8Array());
    assert.equal(textOf(await call(tool("read"), { path: "empty.txt", offset: 1 })), "(/work/empty.txt is empty)");
  });

  test("a file longer than the default limit is returned in parts", async () => {
    const lines = Array.from({ length: BUILTIN_TOOL_DEFAULTS.read.defaultLimit + 5 }, (_, index) => `line ${index}`);
    const { sandbox, tool } = await setup();
    await sandbox.writeFile("/work/long.txt", new TextEncoder().encode(lines.join("\n")));
    const result = await call(tool("read"), { path: "long.txt" });
    assert.match(textOf(result), /\[lines 1 to 2000 of 2005; read on with offset 2001\]$/);
  });

  test("a file larger than one page is returned in pages of at most maxBytes, and a long line in parts", async () => {
    const { maxBytes } = BUILTIN_TOOL_DEFAULTS.read;
    // Each é is two bytes, so the line is one and a half pages, and its second part fits in one.
    const long = "é".repeat((maxBytes * 3) / 4);
    const { tool } = await setup({}, undefined, { "wide.txt": `short\n${long}\nend\n` });
    const first = await call(tool("read"), { path: "wide.txt" });
    assert.equal(textOf(first), "short\n[lines 1 to 1 of 3; read on with offset 2]");
    const part = await call(tool("read"), { path: "wide.txt", offset: 2 });
    const [shown = "", notice = ""] = textOf(part).split("\n");
    assert.ok(new TextEncoder().encode(shown).length < maxBytes);
    assert.equal(notice, `[line 2 of 3 goes on; read on with offset 2 and column ${shown.length + 1}]`);
    const rest = await call(tool("read"), { path: "wide.txt", offset: 2, column: shown.length + 1 });
    assert.equal(textOf(rest), `${long.slice(shown.length)}\nend\n`);
    const past = await call(tool("read"), { path: "wide.txt", offset: 1, column: 9 });
    assert.equal(past.isError, true);
  });

  test("a failed file call's message is one sentence with one stop, whether or not the message ends in one", async () => {
    const { sandbox: inner } = await setup();
    for (const [message, shown] of [
      ["could not read /work/a.txt.", "Could not read /work/a.txt."],
      ["could not read /work/a.txt", "Could not read /work/a.txt."],
    ]) {
      const failing: Sandbox = {
        ...inner,
        readFile: async () => {
          throw new HarnessError("sandbox_io_failed", message as string);
        },
      };
      const read = builtinTools(failing, undefined, { root: ROOT, policy: POLICY }).find(
        (entry) => entry.name === "read",
      );
      assert.ok(read !== undefined);
      const result = await call(read.definition, { path: "a.txt" });
      assert.equal(result.isError, true);
      assert.equal(textOf(result), shown);
    }
  });

  test("two different paths, no path, and a binary file are error results", async () => {
    const { sandbox, tool } = await setup();
    assert.equal((await call(tool("read"), { path: "a", file_path: "b" })).isError, true);
    assert.equal((await call(tool("read"), {})).isError, true);
    await sandbox.writeFile("/work/blob.bin", new Uint8Array([1, 0, 2]));
    const binary = await call(tool("read"), { path: "blob.bin" });
    assert.equal(binary.isError, true);
    assert.match(textOf(binary), /binary file of 3 bytes/);
  });
});

describe("a big result passes the write cap, and read opens its spill", () => {
  const big = `${Array.from({ length: 400 }, (_, index) => `row ${index} ${"x".repeat(40)}`).join("\n")}\n`;
  const spillPathIn = (request: RecordedRequest): string => {
    const tool = request.context.messages.findLast((message) => message.role === "tool");
    const text = JSON.stringify(tool);
    const path = /the full text is in ([^\s\]"\\]+)/.exec(text)?.[1];
    assert.ok(path !== undefined, "the capped result names its spill");
    return path;
  };

  test("read of a spill path returns the full output", async () => {
    const spill = memorySpillStore();
    const client = fakeSandbox();
    const sandbox = await client.provision({ root: ROOT, files: { "big.txt": big } }, POLICY);
    const tools = builtinTools(sandbox, undefined, { root: ROOT, policy: POLICY, spills: (path) => spill.read(path) });
    let spillPath = "";
    const steps: ScriptStep[] = [
      toolCall("bash", { command: "cat big.txt" }, "c1"),
      (request) => {
        spillPath = spillPathIn(request);
        return toolCall("read", { path: spillPath, offset: 1, limit: 2 }, "c2") as never;
      },
      done,
    ];
    const policy = createContextPolicy({ spill, writeCapBytes: 4096 });
    const { entries } = await runTools(steps, tools, policy);
    const [capped, page] = results(entries);
    assert.ok(capped?.spill !== undefined && page !== undefined);
    assert.ok(entryText(capped).length < 4096);
    assert.equal(
      entryText(page),
      "row 0 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nrow 1 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n[lines 1 to 2 of 402; read on with offset 3]",
    );
    const read = tools.find((tool) => tool.name === "read")?.definition;
    assert.ok(read !== undefined);
    const full = await call(read, { path: spillPath });
    assert.equal(textOf(full), spill.read(spillPath));
    assert.equal(textOf(full), `${big}\n[exit code 0]`);
  });

  // The second line is all quotes and backslashes, each two bytes in the log, so a page counted in raw bytes overflows.
  const lines = {
    plain: Array.from({ length: 90_000 }, (_, index) => `${index % 10}abcdefghi`).join(""),
    "quote-dense": '"\\'.repeat(450_000),
  };
  const room = 65_536 - 1024;
  const logBytes = (text: string): number => new TextEncoder().encode(JSON.stringify(text)).length - 2;

  test.each(Object.entries(lines))(
    "a %s line of 900 KB that the cap cut is read back from its spill, page by page, in full",
    async (_, line) => {
      const spill = memorySpillStore();
      const client = fakeSandbox();
      const sandbox = await client.provision({ root: ROOT, files: { "line.txt": line } }, POLICY);
      const tools = builtinTools(sandbox, undefined, {
        root: ROOT,
        policy: POLICY,
        spills: (path) => spill.read(path),
      });
      let spillPath = "";
      const steps: ScriptStep[] = [
        toolCall("bash", { command: "cat line.txt" }, "c1"),
        (request) => {
          spillPath = spillPathIn(request);
          return toolCall("read", { path: spillPath }, "c2") as never;
        },
        done,
      ];
      const { entries } = await runTools(steps, tools, createContextPolicy({ spill }));
      const [capped, firstPage] = results(entries);
      assert.ok(capped?.spill !== undefined && firstPage !== undefined);
      assert.equal(firstPage.spill, undefined, "a page of a spill fits under the write cap");
      const read = tools.find((tool) => tool.name === "read")?.definition;
      assert.ok(read !== undefined);
      // Read every page, as the model would, following each notice, and join what the pages show.
      let joined = "";
      let next: Record<string, number> = {};
      for (let pages = 0; pages < 100; pages += 1) {
        const text = textOf(await call(read, { path: spillPath, ...next }));
        assert.ok(logBytes(text) <= room, "every page fits under the default write cap");
        const notice =
          /\n\[(?:line \d+ of \d+ goes on|lines \d+ to \d+ of \d+); read on with offset (\d+)(?: and column (\d+))?\]$/.exec(
            text,
          );
        if (notice === null) {
          joined += text;
          break;
        }
        const body = text.slice(0, notice.index);
        joined += notice[2] === undefined ? `${body}\n` : body;
        next = { offset: Number(notice[1]), ...(notice[2] === undefined ? {} : { column: Number(notice[2]) }) };
      }
      // The spill is the command's output and its exit line; a page always ends its last line.
      assert.equal(joined, `${spill.read(spillPath)}\n`);
      assert.equal(joined, `${line}\n[exit code 0]\n`);
    },
  );

  test("a page of a file dense with newlines and quotes reaches the model whole, under the default write cap", async () => {
    const dense = `${'"\\"'.repeat(3)}\n`.repeat(20_000);
    const client = fakeSandbox();
    const sandbox = await client.provision({ root: ROOT, files: { "dense.txt": dense } }, POLICY);
    const tools = builtinTools(sandbox, undefined, { root: ROOT, policy: POLICY });
    const steps = [toolCall("read", { path: "dense.txt", limit: 20_000 }), done];
    const { entries } = await runTools(steps, tools, createContextPolicy({ spill: memorySpillStore() }));
    const [page] = results(entries);
    assert.ok(page !== undefined);
    assert.equal(page.spill, undefined, "the page was not cut by the write cap");
    assert.ok(logBytes(entryText(page)) <= BUILTIN_TOOL_DEFAULTS.read.maxBytes + 256);
    assert.match(entryText(page), /\n\[lines 1 to \d+ of 20000; read on with offset \d+\]$/);
  });

  test("a relative path reads the workspace file, even when a spill of the session has its name", async () => {
    const dir = mkdtempSync(join(tmpdir(), "builtin-spill-"));
    try {
      const store = fileSpillStore({ dir });
      const spilled = await store.write(KEY, "c1", "the spilled text");
      const spills = (path: string) => store.read(KEY, path);
      const { tool } = await setup({ spills }, undefined, { "c1.txt": "the workspace file\n" });
      assert.equal(textOf(await call(tool("read"), { path: "c1.txt" })), "the workspace file\n");
      assert.equal(textOf(await call(tool("read"), { path: spilled })), "the spilled text");
      assert.equal(await store.read(KEY, "c1.txt"), undefined);
      // The tool asks no reader about a relative path, even one that would answer for any name.
      const greedy = await setup({ spills: () => "a spill" }, undefined, { "c1.txt": "the workspace file\n" });
      assert.equal(textOf(await call(greedy.tool("read"), { path: "c1.txt" })), "the workspace file\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the file spill store reads back only its own session's spills", async () => {
    const dir = mkdtempSync(join(tmpdir(), "builtin-spill-"));
    try {
      const store = fileSpillStore({ dir });
      const mine = await store.write(KEY, "r1.0.c1", "full text");
      const theirs = await store.write({ userId: "bob", sessionId: "s9" }, "r1.0.c1", "not yours");
      assert.equal(await store.read(KEY, mine), "full text");
      assert.equal(await store.read(KEY, theirs), undefined);
      assert.equal(await store.read(KEY, join(dir, "..", "elsewhere.txt")), undefined);
      const outside = join(dir, "outside.txt");
      writeFileSync(outside, "secret");
      const folder = join(dir, "ada", "s1");
      mkdirSync(folder, { recursive: true });
      symlinkSync(outside, join(folder, "link.txt"));
      assert.equal(await store.read(KEY, join(folder, "link.txt")), undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("grep and glob", () => {
  test("with fakeSandbox(), grep finds a pattern in a seeded file and glob lists matching paths, and neither writes a file", async () => {
    const { client, tool } = await setup();
    const before = new Map(client.files());
    const grep = await call(tool("grep"), { pattern: "answer" });
    assert.equal(textOf(grep), "/work/src/app.ts:1:export const answer = 42;");
    const glob = await call(tool("glob"), { pattern: "**/*.ts" });
    assert.equal(textOf(glob), "/work/src/app.ts\n/work/src/deep/util.ts");
    assert.deepEqual(client.files(), before);
    assert.deepEqual(
      client.execs.map((exec) => exec.command[0]),
      ["find", "grep", "find"],
    );
  });

  test("grep's glob filters by file name, or by the path below the search folder when it has a slash", async () => {
    const { tool } = await setup();
    assert.equal(
      textOf(await call(tool("grep"), { pattern: "TODO", glob: "*.ts" })),
      "/work/src/deep/util.ts:1:// TODO: tidy",
    );
    const none = await call(tool("grep"), { pattern: "TODO", glob: "src/*.ts" });
    assert.match(textOf(none), /^No line under \/work matches TODO/);
    const insensitive = await call(tool("grep"), { pattern: "ALPHA B", ignore_case: true, path: "notes.md" });
    assert.equal(textOf(insensitive), "/work/notes.md:3:alpha beta");
  });

  test("a relative glob below a search base of / keeps the first path segment", async () => {
    const policy: SandboxPolicy = { readRoots: ["/"], writeRoots: [ROOT], network: { allow: [], deny: [] } };
    // A policy that reads the whole disk is only accepted from a sandbox that claims no stops.
    const client = fakeSandbox({ stops: [] });
    const sandbox = await client.provision({ root: ROOT, files: { "../etc/x": "needle\n" } }, policy);
    const tools = builtinTools(sandbox, undefined, { root: ROOT, policy });
    const glob = tools.find((entry) => entry.name === "glob")?.definition;
    assert.ok(glob);
    assert.match(textOf(await call(glob, { pattern: "etc/*", path: "/" })), /\/etc\/x/);
  });

  test("glob matches below its folder, and a read root can be searched", async () => {
    const { tool } = await setup();
    assert.equal(textOf(await call(tool("glob"), { pattern: "*.ts", path: "src" })), "/work/src/app.ts");
    assert.equal(textOf(await call(tool("glob"), { pattern: "*.md", path: "/docs" })), "/docs/guide.md");
    assert.match(textOf(await call(tool("glob"), { pattern: "*.py" })), /^No file under \/work matches/);
  });

  for (const path of ["..", "/etc", "../etc", "src/../../etc"]) {
    test(`grep and glob in ${path} are refused before the sandbox is called`, async () => {
      const { sandbox, tool } = await setup();
      for (const name of ["grep", "glob"]) {
        const result = await call(tool(name), { pattern: "root", path });
        assert.equal(result.isError, true, name);
        assert.match(textOf(result), /outside the folders this tool may read/);
      }
      assert.deepEqual(sandbox.calls, []);
    });
  }

  test("a search that starts in a skipped folder still searches it, and skips the ones inside it", async () => {
    const files = { ...FILES, "node_modules/dep/node_modules/inner.ts": "export const answer = 1;\n" };
    const { tool } = await setup({}, undefined, files);
    const grep = await call(tool("grep"), { pattern: "answer", path: "node_modules" });
    assert.equal(textOf(grep), "/work/node_modules/dep/index.ts:1:export const answer = 0;");
    const glob = await call(tool("glob"), { pattern: "**/*.ts", path: "node_modules" });
    assert.equal(textOf(glob), "/work/node_modules/dep/index.ts");
  });

  test("grep keeps at most its output cap of matching lines, across batches too, and says the rest were dropped", async () => {
    const { maxOutputBytes } = BUILTIN_TOOL_DEFAULTS.grep;
    const row = `match ${"x".repeat(94)}\n`;
    const oneFile = { "big.log": row.repeat(Math.ceil((maxOutputBytes * 1.2) / row.length)) };
    const perFile = row.repeat(Math.ceil((maxOutputBytes * 1.2) / row.length / 400));
    const manyFiles = Object.fromEntries(Array.from({ length: 400 }, (_, index) => [`logs/${index}.log`, perFile]));
    for (const files of [oneFile, manyFiles]) {
      const { client, tool } = await setup({}, undefined, files);
      const text = textOf(await call(tool("grep"), { pattern: "match" }));
      const notice = text.indexOf("\n[the matches passed");
      assert.ok(notice > 0, "the result says matches were dropped");
      assert.ok(new TextEncoder().encode(text.slice(0, notice)).length <= maxOutputBytes);
      assert.match(text.slice(notice), /narrow the pattern, path or glob/);
      for (const line of text.slice(0, notice).split("\n")) assert.match(line, /^\/work\/[\w/.]+:\d+:match x{94}$/);
      for (const exec of client.execs.filter((entry) => entry.command[0] === "grep")) {
        assert.equal(exec.timeoutMs, BUILTIN_TOOL_DEFAULTS.grep.timeoutMs);
      }
    }
  });

  test("a match on a line longer than the output cap is reported as a match too long to show, never as no match", async () => {
    const { maxOutputBytes } = BUILTIN_TOOL_DEFAULTS.grep;
    const { tool } = await setup({}, undefined, { "dist/min.js": `${"x".repeat(maxOutputBytes * 1.2)}needle\n` });
    const text = textOf(await call(tool("grep"), { pattern: "needle" }));
    assert.doesNotMatch(text, /No line/);
    assert.match(text, /^Lines under \/work match needle, but the first matching line is longer than \d+ bytes/);
    assert.match(text, /The first is in \/work\/dist\/min\.js, on line 1\. Narrow the pattern, path or glob, or read/);
    assert.match(text, /\[the matches passed \d+ bytes/);
  });

  test("a grep or find that fails on part of the tree keeps what it found and warns", async () => {
    const { sandbox: inner } = await setup();
    const failing: Sandbox = {
      ...inner,
      async exec(command, options): Promise<ExecResult> {
        const result = await inner.exec(command, options);
        if ("denied" in result) return result;
        if (command[0] === "grep") return { ...result, exitCode: 2, stderr: "grep: /work/secret: Permission denied\n" };
        return { ...result, exitCode: 1, stderr: "find: '/work/locked': Permission denied\n" };
      },
    };
    const tools = builtinTools(failing, undefined, { root: ROOT, policy: POLICY });
    const tool = (name: string) =>
      tools.find((entry) => entry.name === name)?.definition as ToolDefinition<unknown, unknown, unknown>;
    const grep = await call(tool("grep"), { pattern: "answer" });
    assert.equal(grep.isError, undefined);
    assert.match(textOf(grep), /^\/work\/src\/app\.ts:1:export const answer = 42;\n/);
    assert.match(
      textOf(grep),
      /\[grep exited with 2, so some files may be missing: grep: \/work\/secret: Permission denied\]/,
    );
    assert.match(textOf(grep), /\[find exited with 1, so some files may be missing: find: '\/work\/locked'/);
    const glob = await call(tool("glob"), { pattern: "**/*.ts" });
    assert.equal(glob.isError, undefined);
    assert.match(textOf(glob), /^\/work\/src\/app\.ts\n\/work\/src\/deep\/util\.ts\n\[find exited with 1/);
  });

  test("a pattern grep can't read is an error result, and a folder that does not exist is too", async () => {
    const { tool } = await setup();
    const bad = await call(tool("grep"), { pattern: "(" });
    assert.equal(bad.isError, true);
    assert.match(textOf(bad), /^grep failed: grep: /);
    const missing = await call(tool("glob"), { pattern: "*", path: "absent" });
    assert.equal(missing.isError, true);
    assert.match(textOf(missing), /Listing \/work\/absent failed with exit code 1/);
  });

  test("a search through a symlink that leads out of the roots finds nothing outside them", async () => {
    const { client, tool } = await setup();
    client.symlink("/work/link", "/etc");
    for (const name of ["grep", "glob"]) {
      const result = await call(tool(name), { pattern: name === "grep" ? "root" : "*", path: "link" });
      assert.equal(result.isError, true, name);
      assert.doesNotMatch(textOf(result), /root:x|passwd/);
    }
  });
});

describe("fetch", () => {
  test("a fetch to a host that is not on the allowlist returns an error result", async () => {
    const records: EgressRecord[] = [];
    const proxy = await startEgressProxy({ allow: ["api.example.com"], log: (record) => records.push(record) });
    try {
      const { tool } = await setup({}, proxy);
      const result = await call(tool("fetch"), { url: "https://evil.example.org/steal" });
      assert.equal(result.isError, true);
      assert.match(textOf(result), /refused evil\.example\.org: not_allowed/);
      assert.deepEqual(
        records.map((record) => [record.host, record.status, record.reason]),
        [["evil.example.org", 403, "not_allowed"]],
      );
    } finally {
      await proxy.close();
    }
  });

  test("a URL that is not https is refused before the proxy is asked", async () => {
    const asked: string[] = [];
    const proxy: FetchProxy = {
      async fetch(input) {
        asked.push(String(input));
        return new Response("");
      },
      knownSecrets: async () => [],
    };
    const { tool } = await setup({}, proxy);
    for (const url of ["http://egress.proxy/github/user", "file:///etc/passwd", "not a url"]) {
      assert.equal((await call(tool("fetch"), { url })).isError, true, url);
    }
    assert.deepEqual(asked, []);
  });

  test("a fetched body has every known secret removed, and a binary body is described, not shown", async () => {
    const bodies: Record<string, Response> = {
      "https://api.example.com/echo": new Response("token=sk-live-123 ok", {
        headers: { "content-type": "text/plain" },
      }),
      "https://api.example.com/logo": new Response(new Uint8Array([137, 80]), {
        headers: { "content-type": "image/png" },
      }),
    };
    const proxy: FetchProxy = {
      fetch: async (input) => bodies[String(input)] ?? new Response("", { status: 404 }),
      knownSecrets: async () => ["sk-live-123"],
    };
    const { tool } = await setup({}, proxy);
    const echo = textOf(await call(tool("fetch"), { url: "https://api.example.com/echo" }));
    assert.match(echo, /^HTTP 200/);
    assert.match(echo, /token=\[REDACTED\] ok$/);
    assert.doesNotMatch(echo, /sk-live-123/);
    const logo = textOf(await call(tool("fetch"), { url: "https://api.example.com/logo" }));
    assert.match(logo, /\[a image\/png body of 2 bytes was left out\]$/);
  });

  test("a secret that the body's cut splits leaks none of its characters", async () => {
    const { maxBodyBytes } = BUILTIN_TOOL_DEFAULTS.fetch;
    const secret = "sk-live-0123456789";
    const body = `${"a".repeat(maxBodyBytes - 6)}${secret} and more`;
    const proxy: FetchProxy = {
      fetch: async () => new Response(body, { headers: { "content-type": "text/plain" } }),
      knownSecrets: async () => [secret],
    };
    const { tool } = await setup({}, proxy);
    const text = textOf(await call(tool("fetch"), { url: "https://api.example.com/long" }));
    assert.match(text, /\[the body was cut at \d+ bytes\]$/);
    // Every prefix of the secret, down to its first three characters, is gone from the end of the kept body.
    assert.equal(text.includes("sk-"), false);
    assert.match(text, /a\n\[the body was cut/);
  });

  test("a body with no content type is shown only when it reads as text", async () => {
    const bodies: Record<string, () => Response> = {
      "https://api.example.com/blob": () => new Response(new Uint8Array([0x89, 0x50, 0x00, 0x01])),
      "https://api.example.com/latin1": () => new Response(new Uint8Array([0x63, 0x61, 0x66, 0xe9])),
      "https://api.example.com/text": () => new Response(new TextEncoder().encode("plain words")),
    };
    const proxy: FetchProxy = {
      fetch: async (input) => (bodies[String(input)] ?? (() => new Response("", { status: 404 })))(),
      knownSecrets: async () => [],
    };
    const { tool } = await setup({}, proxy);
    for (const name of ["blob", "latin1"]) {
      const text = textOf(await call(tool("fetch"), { url: `https://api.example.com/${name}` }));
      assert.match(text, /\[a body of 4 bytes with no content type was left out, because it is not text\]$/, name);
    }
    assert.match(textOf(await call(tool("fetch"), { url: "https://api.example.com/text" })), /\n\nplain words$/);
  });

  test("a body is read in the charset its content type names, and an unknown charset is shown only as UTF-8", async () => {
    const { maxBodyBytes } = BUILTIN_TOOL_DEFAULTS.fetch;
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);
    // Two copyright signs end the cut body: in ISO-8859-1 each is the one byte 0xa9, which UTF-8 reads as a
    // continuation byte, so a cut that backed off as UTF-8 does would drop the first one.
    const longLatin1 = new Uint8Array(maxBodyBytes + 1).fill(0x61);
    longLatin1.set([0xa9, 0xa9], maxBodyBytes - 1);
    const bodies: Record<string, () => Response> = {
      "https://api.example.com/latin1": () =>
        new Response(latin1, { headers: { "content-type": 'text/plain; charset="ISO-8859-1"' } }),
      "https://api.example.com/bogus-latin1": () =>
        new Response(latin1, { headers: { "content-type": "text/plain; charset=bogus" } }),
      "https://api.example.com/bogus-utf8": () =>
        new Response(new TextEncoder().encode("café"), { headers: { "content-type": "text/plain; charset=bogus" } }),
      "https://api.example.com/long": () =>
        new Response(longLatin1, { headers: { "content-type": "text/plain; charset=iso-8859-1" } }),
    };
    const proxy: FetchProxy = {
      fetch: async (input) => (bodies[String(input)] ?? (() => new Response("", { status: 404 })))(),
      knownSecrets: async () => [],
    };
    const { tool } = await setup({}, proxy);
    const get = async (name: string) => textOf(await call(tool("fetch"), { url: `https://api.example.com/${name}` }));
    assert.match(await get("latin1"), /\n\ncafé$/);
    assert.match(
      await get("bogus-latin1"),
      /\[a body of 4 bytes in an unknown charset was left out, because it is not text\]$/,
    );
    assert.match(await get("bogus-utf8"), /\n\ncafé$/);
    assert.match(await get("long"), /a©\n\[the body was cut at \d+ bytes\]$/);
  });

  test("without a proxy there is no fetch tool", async () => {
    const { tools } = await setup();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ["read", "write", "edit", "bash", "grep", "glob"],
    );
  });
});

describe("the tool set", () => {
  const proxy: FetchProxy = { fetch: async () => new Response(""), knownSecrets: async () => [] };

  test("read, fetch, grep and glob are first-party and read-only; write, edit and bash are writes", async () => {
    const { tools } = await setup({}, proxy);
    const flags = Object.fromEntries(
      tools.map(({ name, definition }) => [
        name,
        [definition.firstParty, definition.annotations?.readOnlyHint === true, definition.effect?.kind ?? "none"],
      ]),
    );
    assert.deepEqual(flags, {
      read: [true, true, "none"],
      write: [true, false, "write"],
      edit: [true, false, "write"],
      bash: [true, false, "write"],
      grep: [true, true, "none"],
      glob: [true, true, "none"],
      fetch: [true, true, "none"],
    });
    assert.equal(tools.find((tool) => tool.name === "bash")?.definition.executionMode, "sequential");
  });

  test("every tool registers as a built-in, and only fetch's output is untrusted", async () => {
    const { tools } = await setup({}, proxy);
    const registry = createToolRegistry();
    const registered = tools.map((tool) => registry.register(tool));
    assert.deepEqual(
      registered.map((tool) => [tool.canonicalName, tool.source, tool.outputTrust]),
      [
        ["read", "builtin", "trusted"],
        ["write", "builtin", "trusted"],
        ["edit", "builtin", "trusted"],
        ["bash", "builtin", "trusted"],
        ["grep", "builtin", "trusted"],
        ["glob", "builtin", "trusted"],
        ["fetch", "builtin", "untrusted"],
      ],
    );
  });

  test("BUILTIN_TOOLS_HASH is the hash of the descriptions and limits, and each tool uses its own", async () => {
    const fresh = await canonicalInputHash(BUILTIN_TOOL_DEFAULTS);
    assert.equal(
      BUILTIN_TOOLS_HASH,
      fresh,
      `A built-in tool's description or limit changed. Set BUILTIN_TOOLS_HASH in src/tools/builtins/descriptions.ts to "${fresh}".`,
    );
    const { tools } = await setup({}, proxy);
    for (const { name, definition } of tools) {
      const own = BUILTIN_TOOL_DEFAULTS[name as keyof typeof BUILTIN_TOOL_DEFAULTS] as { description?: string };
      assert.equal(definition.description, own.description, name);
    }
  });

  test("a root or policy root that is not absolute is refused", async () => {
    const sandbox = await fakeSandbox().provision({ root: ROOT }, POLICY);
    for (const [root, policy] of [
      ["work", POLICY],
      [ROOT, { ...POLICY, writeRoots: ["work"] }],
      [ROOT, { ...POLICY, readRoots: [""] }],
    ] as const) {
      assert.throws(
        () => builtinTools(sandbox, undefined, { root, policy }),
        (error: unknown) => isHarnessError(error) && error.code === "invalid_tool_options",
      );
    }
  });
});
