---
name: pi
description: Use when writing, reviewing or testing TypeScript that imports `@earendil-works/pi-coding-agent`, `pi-agent-core` or `pi-ai` (createAgentSession, defineTool, extensions, tool_call gates, steering, session trees, compaction, fauxProvider). Gives the verified setup, the gating pattern, the gotchas from our fact-check, and how to test offline with the faux provider.
---

# Pi (`@earendil-works/pi-coding-agent@1.5.2`)

Pi runs a full coding harness in your process as three packages: `pi-ai` (models), `pi-agent-core` (loop) and `pi-coding-agent` (SDK, tools, sessions, extensions). It ships no permission system, so you gate tool calls in an extension and isolate the process yourself. Full reference: [`docs/reference/pi/guide.md`](../../../docs/reference/pi/guide.md); verified examples: [`verify/pi/examples/`](../../../verify/pi/examples/).

## When to use it

Choose Pi to own and read the whole harness, including its tree-shaped sessions and compaction, across any of `pi-ai`'s providers. Choose the Claude Agent SDK if you want built-in permissions, or the OpenAI Agents SDK for resumable approvals and guardrails ([comparison](../../../docs/comparison/deep-comparison.md)).

## Minimal setup

```bash
pnpm add @earendil-works/pi-coding-agent typebox   # Node.js 22.19+; in this repo: pnpm only, exact pins
```

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession, DefaultResourceLoader, defineTool, ModelRuntime, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const cwd = mkdtempSync(join(tmpdir(), "agent-"));
const agentDir = join(cwd, ".pi-agent");
const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null }); // else it writes ~/.pi/agent/auth.json
const model = modelRuntime.getModel("anthropic", "claude-sonnet-4-5");   // explicit model, never "first available"

const escalate = defineTool({
  name: "escalate", label: "Escalate", description: "Escalate to on-call",
  parameters: Type.Object({ reason: Type.String() }),
  execute: async () => ({ content: [{ type: "text", text: "escalated" }], details: {} }),
});
const resourceLoader = new DefaultResourceLoader({
  cwd, agentDir,                                   // both required
  extensionFactories: [(pi) => {
    pi.on("tool_call", async (e) => (e.toolName === "escalate" ? { block: true, reason: "Needs a human" } : undefined));
  }],
});
await resourceLoader.reload();
const { session } = await createAgentSession({
  cwd, resourceLoader, model, modelRuntime,        // always pass the model explicitly
  noTools: "builtin", customTools: [escalate],
  sessionManager: SessionManager.inMemory(), settingsManager: SettingsManager.inMemory(),
});
try {
  await session.prompt("Triage this ticket.");
  console.log(session.getLastAssistantText());
} finally {
  session.dispose();
}
```

## Patterns that hold (verified)

- **Default tools are `read`, `bash`, `edit`, `write`.** Narrow with `tools: [...]`, `excludeTools: [...]` or `noTools: "builtin"`.
- **The only gate is an extension's `tool_call` handler.** Returning `{ block: true, reason }` stops the call, and the reason reaches the model as an error tool result.
- **Typed output comes from a final tool** whose parameters are the schema. Its `execute` returns `{ content, details, terminate: true }` and stores the value itself (in a closure); the run ends without another model turn, provided every result in that tool batch sets `terminate`.
- **Events:** `agent_start`, `turn_*`, `message_*`, `tool_execution_*`, `agent_end`, then `agent_settled` once queued work is done.
- **Mid-run input** must say how it joins: `steer(text)` after the current turn, `followUp(text)` after the run; a bare `prompt()` mid-run rejects.
- **Sessions are a tree.** `sessionManager.branch(id)` starts a new path and keeps the old one; compaction appends a summary entry and deletes nothing.
- **An inactive tool call** returns an error tool result instead of crashing the run.

## Gotchas (from the fact-check)

- **Without an explicit model,** a session picks one from settings or "first available", and Bedrock or Vertex can authenticate from ambient cloud credentials. Always pass `model` and `modelRuntime`, and scrub the environment.
- **Sessions discover settings, extensions, skills and `AGENTS.md`** from `cwd` and `~/.pi/agent`. Embedded agents should pass in-memory managers and an explicit `DefaultResourceLoader`, and `ModelRuntime.create({ authPath, modelsPath: null })`; otherwise the runtime creates `~/.pi/agent/auth.json` (fact-check F6).
- **Extensions get an "extension view" of `pi-ai`** with `Type` and deprecated helpers; code outside an extension imports deprecated helpers from `@earendil-works/pi-ai/compat`.
- **docs.pi.dev/latest renders the main branch,** ahead of the npm release. Read the docs at your release tag (the mirror in `docs/reference/pi/source/`).
- **SDK sessions start without** the CLI's `codemode`, `tool_search` and MCP extensions; add `createMcpExtension()` and friends yourself.
- **No turn cap exists** in 1.5.2; stop runaway runs with `abort()` or a gate.

## Test offline

Use pi-ai's `fauxProvider()`: queue `fauxAssistantMessage([...])` responses with `fauxToolCall(name, args)` and `fauxText(text)`, register it with `modelRuntime.registerNativeProvider(faux.provider)` on a `ModelRuntime.create({ refreshOnCreate: false, authPath, modelsPath: null })`, and pass `faux.getModel()` as the model. A response can also be a function `(context, options, state, model) => AssistantMessage`, which lets a test inspect what the model received; `faux.state.callCount` counts model calls, and `session.getActiveToolNames()` lists active tools. `fauxSession()` in [`verify/pi/examples/lib/faux.ts`](../../../verify/pi/examples/lib/faux.ts) wires this up. Run one new file offline, without touching committed results, from `verify/pi`: `node scripts/run-examples.mjs <dir> --only <name>` (it prints only the outcome; run the file with tsx to see its output). Run the verified examples with:

```bash
pnpm --filter @agent-speak/verify-pi test
```
