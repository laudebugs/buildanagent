// The tool registry: canonical names, duplicates, exposure per source, stable definition order, host context through a
// wrapper, output trust defaults and the preamble size.
import assert from "node:assert/strict";
import { createModel } from "@buildanagent/gateway";
import { isHarnessError } from "@buildanagent/harness";
import {
  createToolRegistry,
  DuplicateToolError,
  type RegisteredTool,
  type ToolRegistration,
} from "@buildanagent/harness/tools";
import { defineTool, run } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { test } from "vitest";

/** A tool that records the host context it was bound to when it ran. */
function tool(name: string, description = `The ${name} tool.`) {
  return defineTool({
    name,
    description,
    inputSchema: { type: "object", properties: {} },
    async execute() {
      return { content: [{ type: "text", text: `${name} ran` }] };
    },
  });
}

// The definition keeps a plain name of its own: the registry, not the definition, decides the canonical name.
function registration(name: string, source: ToolRegistration["source"], extra: Partial<ToolRegistration> = {}) {
  return { name, source, definition: tool("source_name"), ...extra } satisfies ToolRegistration;
}

const names = (tools: readonly RegisteredTool[]) => tools.map((entry) => entry.canonicalName);

test("a built-in registers under its own name, with defaults for pattern, exposure, trust and approval reuse", () => {
  const registry = createToolRegistry();
  const read = registry.register(registration("read", "builtin"));
  assert.deepEqual(
    [read.canonicalName, read.pattern, read.exposure, read.outputTrust, read.approvalReuse, read.remoteAgent],
    ["read", "in_process", "direct", "trusted", "both", false],
  );
  assert.equal(registry.get("read"), read);
});

test("registering two tools with one name throws a DuplicateToolError", () => {
  const registry = createToolRegistry();
  registry.register(registration("read", "builtin"));
  for (const source of ["builtin", "extension", "client"] as const) {
    assert.throws(
      () => registry.register(registration("read", source)),
      (error) => error instanceof DuplicateToolError && isHarnessError(error) && error.code === "duplicate_tool",
    );
  }
  assert.deepEqual(names(registry.list()), ["read"], "a refused tool leaves the registry as it was");
});

test("an extension replaces a built-in only with override: true, and keeps its place in the order", () => {
  const registry = createToolRegistry();
  registry.register(registration("read", "builtin"));
  registry.register(registration("write", "builtin"));
  assert.throws(() => registry.register(registration("read", "extension")), DuplicateToolError);
  const replaced = registry.register(registration("read", "extension", { override: true }));
  assert.equal(replaced.source, "extension");
  assert.deepEqual(names(registry.list()), ["read", "write"]);
  // Override reaches only a built-in: an extension's tool, and a built-in over a built-in, stay refused.
  assert.throws(() => registry.register(registration("read", "client", { override: true })), DuplicateToolError);
  assert.throws(() => registry.register(registration("write", "builtin", { override: true })), DuplicateToolError);
});

test("an MCP tool is namespaced, and two servers with one tool name get distinct, stable names", () => {
  const first = createToolRegistry();
  const github = first.register(registration("search", "mcp:github"));
  const linear = first.register(registration("search", "mcp:linear"));
  assert.equal(github.canonicalName, "mcp__github__search");
  assert.equal(linear.canonicalName, "mcp__linear__search");
  // Two servers whose names clean to the same text collide, and the later one gets a hash suffix.
  const a = first.register(registration("run", "mcp:my.server"));
  const b = first.register(registration("run", "mcp:my:server"));
  assert.equal(a.canonicalName, "mcp__my_server__run");
  assert.match(b.canonicalName, /^mcp__my_server__run_[0-9a-f]{8}$/);
  // The suffix depends on the source and name only, so another registry, in any order, makes the same name.
  const second = createToolRegistry();
  second.register(registration("run", "mcp:my:server"));
  const later = second.register(registration("run", "mcp:my.server"));
  assert.match(later.canonicalName, /^mcp__my_server__run_[0-9a-f]{8}$/);
  const alone = createToolRegistry();
  alone.register(registration("run", "mcp:my.server"));
  assert.equal(alone.register(registration("run", "mcp:my:server")).canonicalName, b.canonicalName);
  // The same server listing the same tool twice is a duplicate, not a collision.
  assert.throws(() => first.register(registration("search", "mcp:github")), DuplicateToolError);
});

test("a long MCP name is cut to 64 characters with a hash suffix, and every canonical name passes the SDK rule", () => {
  const registry = createToolRegistry();
  const long = registry.register(registration("t".repeat(80), "mcp:server"));
  assert.equal(long.canonicalName.length, 64);
  assert.match(long.canonicalName, /^mcp__server__t+_[0-9a-f]{8}$/);
  // The definitions go through defineTool(), so a name that broke the rule would throw here.
  assert.deepEqual(
    names(registry.list()),
    registry.definitions().map((definition) => definition.name),
  );
});

test("a name that breaks the canonical rule, an unknown source and a blank field are refused with a typed error", () => {
  const registry = createToolRegistry();
  const bad: unknown[] = [
    registration("has space", "builtin"),
    registration("", "builtin"),
    registration("x".repeat(65), "extension"),
    registration("read", "mcp:" as "mcp:x"),
    registration("read", "somewhere" as "builtin"),
    registration("read", "builtin", { exposure: "visible" as "direct" }),
    registration("read", "builtin", { pattern: "fax" as "in_process" }),
    registration("read", "builtin", { alias: "" }),
    { name: "read", source: "builtin", definition: {} },
  ];
  for (const input of bad) {
    assert.throws(
      () => registry.register(input as ToolRegistration),
      (error) => isHarnessError(error) && error.code === "invalid_tool_registration",
      JSON.stringify(input),
    );
  }
});

test("an alias is kept apart from the canonical name, and get() finds a tool by either", () => {
  const registry = createToolRegistry();
  const bash = registry.register(registration("bash", "builtin", { alias: "Bash" }));
  assert.equal(bash.canonicalName, "bash");
  assert.equal(bash.alias, "Bash");
  assert.equal(registry.get("Bash"), bash);
  assert.equal(registry.get("bash"), bash);
  assert.equal(registry.get("sh"), undefined);
  // No alias may equal another tool's canonical name or alias, so a rule on either never matches two tools.
  assert.throws(() => registry.register(registration("shell", "extension", { alias: "bash" })), DuplicateToolError);
  assert.throws(() => registry.register(registration("shell", "extension", { alias: "Bash" })), DuplicateToolError);
  assert.throws(() => registry.register(registration("same", "extension", { alias: "same" })), DuplicateToolError);
});

test("exposure defaults to deferred for MCP and direct elsewhere, and setExposure() changes a source, now and later", () => {
  const registry = createToolRegistry();
  const read = registry.register(registration("read", "builtin"));
  const search = registry.register(registration("search", "mcp:github"));
  assert.deepEqual([read.exposure, search.exposure], ["direct", "deferred"]);
  registry.setExposure("mcp:github", "direct");
  assert.equal(registry.get("mcp__github__search")?.exposure, "direct");
  assert.equal(
    registry.register(registration("issues", "mcp:github")).exposure,
    "direct",
    "a later tool follows the source",
  );
  assert.equal(registry.get("read")?.exposure, "direct", "another source is untouched");
  assert.equal(registry.register(registration("pin", "mcp:github", { exposure: "hidden" })).exposure, "hidden");
  assert.throws(
    () => registry.setExposure("mcp:github", "everywhere" as "direct"),
    isHarnessErrorOf("invalid_tool_registration"),
  );
});

function isHarnessErrorOf(code: string) {
  return (error: unknown) => isHarnessError(error) && error.code === code;
}

test("definitions() keeps registration order, sets each name and exposure, and runs the wrapper with the host context", () => {
  const registry = createToolRegistry();
  registry.register(registration("read", "builtin"));
  registry.register(registration("search", "mcp:github"));
  registry.register(registration("write", "builtin"));
  const seen: unknown[] = [];
  const definitions = registry.definitions(
    (entry, hostContext: { user: string }) => {
      seen.push([entry.canonicalName, hostContext.user]);
      // A wrapper may not rename or expose a tool: the registry overrides both.
      return { ...entry.definition, name: "renamed", exposure: "direct" as const };
    },
    { user: "u1" },
  );
  assert.deepEqual(
    definitions.map((d) => d.name),
    ["read", "mcp__github__search", "write"],
  );
  assert.deepEqual(
    definitions.map((d) => d.exposure),
    ["direct", "deferred", "direct"],
  );
  assert.deepEqual(seen, [
    ["read", "u1"],
    ["mcp__github__search", "u1"],
    ["write", "u1"],
  ]);
  assert.ok(definitions.every((definition) => Object.isFrozen(definition)));
});

test("activeTools() is every direct tool plus the activated names, in registration order, whatever the activation order", () => {
  const registry = createToolRegistry();
  registry.register(registration("a", "builtin"));
  registry.register(registration("b", "mcp:s"));
  registry.register(registration("c", "builtin"));
  registry.register(registration("d", "mcp:s", { exposure: "hidden" }));
  assert.deepEqual(registry.activeTools(new Set()), ["a", "c"]);
  assert.deepEqual(registry.activeTools(new Set(["mcp__s__d", "mcp__s__b"])), ["a", "mcp__s__b", "c", "mcp__s__d"]);
  assert.deepEqual(
    registry.activeTools(new Set(["mcp__s__b", "nothing"])),
    ["a", "mcp__s__b", "c"],
    "an unknown name is left out",
  );
});

test("output trust: untrusted for an MCP tool and a remote-agent tool, trusted for a built-in, and a declared value wins", () => {
  const registry = createToolRegistry();
  const trust = (entry: ToolRegistration) => registry.register(entry).outputTrust;
  assert.equal(trust(registration("read", "builtin")), "trusted");
  assert.equal(trust(registration("ext", "extension")), "trusted");
  assert.equal(trust(registration("search", "mcp:github")), "untrusted");
  assert.equal(trust(registration("ask_agent", "extension", { remoteAgent: true })), "untrusted");
  assert.equal(trust(registration("vetted", "mcp:github", { outputTrust: "trusted" })), "trusted");
  assert.equal(trust(registration("cleaned", "extension", { remoteAgent: true, outputTrust: "trusted" })), "trusted");
  assert.equal(trust(registration("careful", "builtin", { outputTrust: "untrusted" })), "untrusted");
  assert.equal(registry.get("ask_agent")?.remoteAgent, true);
});

test("approval reuse defaults to both and takes any of its four values", () => {
  const registry = createToolRegistry();
  assert.equal(registry.register(registration("a", "builtin")).approvalReuse, "both");
  for (const reuse of ["sticky", "group", "both", "none"] as const) {
    assert.equal(
      registry.register(registration(`t_${reuse}`, "builtin", { approvalReuse: reuse })).approvalReuse,
      reuse,
    );
  }
});

test("the host patterns are recorded per tool", () => {
  const registry = createToolRegistry();
  assert.equal(registry.register(registration("local", "client")).pattern, "in_process");
  assert.equal(
    registry.register(registration("asked", "client", { pattern: "client_request" })).pattern,
    "client_request",
  );
});

test("a host-context value reaches execute through the wrapper and appears in no recorded request or event", async () => {
  const secret = "host-secret-7";
  const seen: string[] = [];
  const registry = createToolRegistry();
  registry.register({
    name: "whoami",
    source: "extension",
    definition: defineTool({
      name: "whoami",
      description: "Reports nothing about the caller.",
      inputSchema: { type: "object", properties: {} },
      async execute() {
        return { content: [{ type: "text", text: "unreachable until wrapped" }] };
      },
    }),
  });
  const tools = registry.definitions(
    (entry, hostContext: { user: string }) =>
      defineTool({
        ...entry.definition,
        async execute() {
          seen.push(hostContext.user);
          return { content: [{ type: "text", text: "ok" }] };
        },
      }),
    { user: secret },
  );
  const adapter = new ScriptedModel([
    { content: [{ type: "tool_call", callId: "c1", name: "whoami", input: {} }] },
    { content: [{ type: "text", text: "Done." }] },
  ]);
  const started = run({
    model: createModel({ adapter, id: "scripted-model", retries: 0 }),
    system: "s",
    input: "Who?",
    tools,
  });
  const events: unknown[] = [];
  for await (const event of started) events.push(event);
  const result = await started.result;
  assert.equal(result.stopReason, "done");
  assert.deepEqual(seen, [secret]);
  assert.ok(!JSON.stringify(adapter.calls).includes(secret), "no request holds the host context");
  assert.ok(!JSON.stringify(events).includes(secret), "no event holds it");
  assert.ok(!JSON.stringify(result.context).includes(secret), "the saved context holds none");
});

test("preambleTokens() counts the system prompt and every direct tool, and a deferred tool adds nothing", () => {
  const registry = createToolRegistry();
  assert.equal(registry.preambleTokens(), 0);
  registry.register(registration("read", "builtin"));
  const one = registry.preambleTokens();
  assert.ok(one > 0);
  registry.register(registration("search", "mcp:github"));
  assert.equal(registry.preambleTokens(), one, "a deferred tool is not in the preamble");
  assert.ok(registry.preambleTokens({ system: "You are a careful agent." }) > one);
  registry.setExposure("mcp:github", "direct");
  assert.ok(registry.preambleTokens() > one, "a tool made direct is");
});
