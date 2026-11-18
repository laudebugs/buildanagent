// The smallest agent: one prompt, no tools, read the ResultMessage.
// Docs: agent-loop.md "Handle the result", quickstart.md
import { query } from "@anthropic-ai/claude-agent-sdk";
import { check, collect } from "./lib/collect.ts";

const { messages, result } = await collect(
  query({ prompt: "Say hello in one sentence.", options: { maxTurns: 3 } }),
);

const init = messages.find((m) => m.type === "system" && m.subtype === "init");
check(init, "first SystemMessage has subtype 'init'");
check(result?.subtype === "success", "ResultMessage subtype is 'success'");
check(result?.subtype === "success" && typeof result.result === "string", "`result` text is present on success");
check(typeof result?.session_id === "string" && result.session_id.length > 0, "ResultMessage carries session_id");
check(typeof result?.total_cost_usd === "number" && typeof result?.num_turns === "number", "ResultMessage carries total_cost_usd and num_turns");
