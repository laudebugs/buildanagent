// Tool search: a deferred tool is absent from every request until `tool_search` activates it, then present in the next
// one, and activation never reorders the tools already sent.
import assert from "node:assert/strict";
import { createModel } from "@buildanagent/gateway";
import { isHarnessError } from "@buildanagent/harness";
import { createToolRegistry, toolSearchInterceptors, toolSearchTool } from "@buildanagent/harness/tools";
import { defineTool, run } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { test } from "vitest";

function tool(description: string) {
  return defineTool({
    name: "source_name",
    description,
    inputSchema: { type: "object", properties: {} },
    async execute() {
      return { content: [{ type: "text", text: "ran" }] };
    },
  });
}

/** A registry with a built-in, the search tool and three deferred MCP tools, one hidden. */
function setup(maxResults?: number) {
  const registry = createToolRegistry();
  const activated = new Set<string>();
  registry.register({ name: "read", source: "builtin", definition: tool("Read a file.") });
  registry.register({
    name: "tool_search",
    source: "builtin",
    definition: toolSearchTool(registry, { activated, ...(maxResults === undefined ? {} : { maxResults }) }),
  });
  registry.register({
    name: "create_issue",
    source: "mcp:github",
    definition: tool("Create an issue in a repository."),
  });
  registry.register({
    name: "list_issues",
    source: "mcp:github",
    definition: tool("List the open issues of a repository."),
  });
  registry.register({ name: "send_message", source: "mcp:slack", definition: tool("Send a message to a channel.") });
  registry.register({
    name: "secret_admin",
    source: "mcp:slack",
    exposure: "hidden",
    definition: tool("Administer secret channels and issues."),
  });
  return { registry, activated };
}

async function runWithSearch(query: string, maxResults?: number) {
  const { registry, activated } = setup(maxResults);
  const adapter = new ScriptedModel([
    { content: [{ type: "tool_call", callId: "c1", name: "tool_search", input: { query } }] },
    { content: [{ type: "text", text: "Done." }] },
  ]);
  const started = run({
    model: createModel({ adapter, id: "scripted-model", retries: 0 }),
    system: "You use tools.",
    input: "Go.",
    tools: registry.definitions(),
    interceptors: toolSearchInterceptors(registry, activated),
  });
  const result = await started.result;
  return { adapter, activated, result, registry };
}

test("a deferred tool is absent from the first request and present in the next, after tool_search activates it", async () => {
  const { adapter, activated, result } = await runWithSearch("create an issue");
  assert.equal(result.stopReason, "done");
  const sent = adapter.calls.map((call) => call.context.tools.map((entry) => entry.name));
  assert.deepEqual(sent[0], ["read", "tool_search"], "only the direct tools go first");
  assert.deepEqual(sent[1], ["read", "tool_search", "mcp__github__create_issue", "mcp__github__list_issues"]);
  assert.deepEqual([...activated].sort(), ["mcp__github__create_issue", "mcp__github__list_issues"]);
});

test("activation does not reorder the tools already sent, and a late match slots in at its registration place", async () => {
  const { registry } = setup();
  const before = registry.activeTools(new Set());
  const after = registry.activeTools(new Set(["mcp__slack__send_message"]));
  assert.deepEqual(
    after.filter((name) => before.includes(name)),
    before,
    "the first request's tools keep their order",
  );
  assert.deepEqual(after, ["read", "tool_search", "mcp__slack__send_message"]);
});

test("the search ranks by matching words, keeps registration order among ties, and honours maxResults", async () => {
  const { activated } = await runWithSearch("issue", 1);
  assert.deepEqual([...activated], ["mcp__github__create_issue"], "one result, the first of the equal scores");
  const ranked = await runWithSearch("list open issues");
  assert.deepEqual([...ranked.activated][0], "mcp__github__list_issues", "more matching words ranks first");
});

test("a hidden tool is never found, and the search tells the model when nothing matches", async () => {
  const { activated, adapter } = await runWithSearch("secret channel admin");
  assert.ok(!activated.has("mcp__slack__secret_admin"), "a hidden tool is not discoverable");
  const reply = adapter.calls[1]?.context.messages.at(-1);
  assert.equal(reply?.role, "tool");
  assert.match(JSON.stringify(reply), /available on your next step/);
  const none = await runWithSearch("zebra");
  assert.equal(none.activated.size, 0);
  assert.match(JSON.stringify(none.adapter.calls[1]?.context.messages.at(-1)), /No tool matches/);
});

test("the search tool's own definition carries a schema the model can fill in, and returns the names as data", async () => {
  const { registry } = setup();
  const search = registry.get("tool_search")?.definition;
  assert.ok(search);
  const outcome = await search.execute({ query: "message" }, {} as never);
  assert.deepEqual(outcome.structured, { activated: ["mcp__slack__send_message"] });
  assert.equal(outcome.isError, undefined);
});

test("a repeated query word counts once, and the server prefix matches nothing by itself", async () => {
  const repeated = await runWithSearch("issue issue issue", 1);
  assert.deepEqual(
    [...repeated.activated],
    ["mcp__github__create_issue"],
    "one distinct word, so the first of the ties",
  );
  const prefix = await runWithSearch("mcp github");
  assert.equal(prefix.activated.size, 0, "the server's name and `mcp` are not in a tool's own name or description");
});

test("toolSearchInterceptors() throws unless the registry holds tool_search, since activeTools is the complete list", () => {
  const registry = createToolRegistry();
  registry.register({ name: "read", source: "builtin", definition: tool("Read a file.") });
  assert.throws(
    () => toolSearchInterceptors(registry, new Set()),
    (error) => isHarnessError(error) && error.code === "invalid_tool_registration",
  );
});

test("a stop word matches nothing, and a maxResults that is not a positive whole number is refused", async () => {
  const stops = await runWithSearch("the tool for the job");
  assert.equal(stops.activated.size, 0, "words found in nearly every description do not make a tool a candidate");
  const { registry } = setup();
  for (const maxResults of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () => toolSearchTool(registry, { activated: new Set(), maxResults }),
      (error) => isHarnessError(error) && error.code === "invalid_tool_registration",
    );
  }
});

test("the search tool is sent even when its source is made deferred, so a model can always find a tool", async () => {
  const { registry, activated } = setup();
  registry.setExposure("builtin", "deferred");
  const names = await new Promise<string[]>((resolve) => {
    const patch = toolSearchInterceptors(registry, activated).beforeModelCall?.({ context: { tools: [] } } as never);
    Promise.resolve(patch).then((value) =>
      resolve([...((value as { activeTools?: string[] } | undefined)?.activeTools ?? [])]),
    );
  });
  assert.deepEqual(names, ["tool_search"]);
});

test("a query word that begins a stop word in a description matches nothing", async () => {
  const { registry, activated } = setup();
  registry.register({
    name: "wide",
    source: "mcp:misc",
    definition: tool("Use this for anything you can think of, and then the rest."),
  });
  const search = toolSearchTool(registry, { activated });
  for (const query of ["fork a thing", "cancel it", "users", "these"]) {
    await search.execute({ query }, {} as never);
  }
  assert.equal(activated.has("mcp__misc__wide"), false, "fork, cancel, users and these are not for, can, use and the");
});

test("toolSearchTool() needs the activated set, because a search that records nothing activates nothing", () => {
  const { registry } = setup();
  assert.throws(
    () => toolSearchTool(registry, {} as never),
    (error) => isHarnessError(error) && error.code === "invalid_tool_registration",
  );
});

test("the interceptor keeps a tool the run passes from outside the registry, and adds only names the registry holds", () => {
  const { registry, activated } = setup();
  activated.add("mcp__github__create_issue");
  activated.add("late_tool");
  const patch = toolSearchInterceptors(registry, activated).beforeModelCall?.({
    context: { tools: [{ name: "read" }, { name: "answer" }] },
  } as never) as { activeTools: string[] };
  assert.deepEqual(patch.activeTools, ["read", "answer", "mcp__github__create_issue", "tool_search"]);
});
