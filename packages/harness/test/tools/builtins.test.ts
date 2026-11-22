// The built-in tools reach files, commands and the web only through the sandbox and the egress proxy, check every
// path before the sandbox sees it, and hand big results to the write cap. Every test runs on fakeSandbox(), so no
// tool call touches a host file or process.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalInputHash } from "@buildanagent/agent-safety";
import { createModel, type Model } from "@buildanagent/gateway";
import { isHarnessError } from "@buildanagent/harness";
import { createContextPolicy, memorySpillStore } from "@buildanagent/harness/context";
import { fileSpillStore } from "@buildanagent/harness/context/file";
import { type EgressRecord, startEgressProxy } from "@buildanagent/harness/credentials";
import type { Sandbox, SandboxPolicy } from "@buildanagent/harness/sandbox";
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

async function setup(options: Partial<BuiltinToolsOptions> = {}, proxy?: FetchProxy) {
  const client = fakeSandbox();
  const sandbox = counting(await client.provision({ root: ROOT, files: FILES }, POLICY));
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
    assert.match(textOf(result), /\[timed out after 20 ms\]/);
    assert.equal(client.execs[0]?.timeoutMs, 20);
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
    const { tool } = await setup();
    const result = await call(tool("read"), { path: "notes.md", offset: 2, limit: 1 });
    assert.equal(textOf(result), "beta\n[lines 2 to 2 of 3; read on with offset 3]");
    const last = await call(tool("read"), { path: "notes.md", offset: 3 });
    assert.equal(textOf(last), "alpha beta\n");
    const past = await call(tool("read"), { path: "notes.md", offset: 9 });
    assert.equal(past.isError, true);
  });

  test("a file longer than the default limit is returned in parts", async () => {
    const lines = Array.from({ length: BUILTIN_TOOL_DEFAULTS.read.defaultLimit + 5 }, (_, index) => `line ${index}`);
    const { sandbox, tool } = await setup();
    await sandbox.writeFile("/work/long.txt", new TextEncoder().encode(lines.join("\n")));
    const result = await call(tool("read"), { path: "long.txt" });
    assert.match(textOf(result), /\[lines 1 to 2000 of 2005; read on with offset 2001\]$/);
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
