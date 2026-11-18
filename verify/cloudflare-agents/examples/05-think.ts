// Think: getModel/getSystemPrompt/getTools configure the loop, runTurn() (mode "wait") runs one
// turn and returns the persisted assistant message, beforeToolCall can block a tool (the model
// sees the reason as its output), and beforeTurn can force structured output, which arrives
// parsed in TurnResult.output. Docs: agents/docs/think/index.md ("Choosing a Turn API"),
// think/lifecycle-hooks.md (beforeTurn, beforeToolCall), think/tools.md.
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { Think, type ToolCallContext, type ToolCallDecision, type TurnContext } from "@cloudflare/think";
import { getAgentByName } from "agents";
import { Output, tool } from "ai";
import { z } from "zod";
import { check, type Harness, rpc, scripted } from "./lib/check.ts";

type Env = { HelpDesk: DurableObjectNamespace<HelpDesk> };
const Verdict = z.object({ severity: z.enum(["low", "high"]), summary: z.string() });

const lastTool = (req: LanguageModelV4CallOptions) => JSON.stringify(req.prompt.at(-1));

export class HelpDesk extends Think<Env> {
  mock = scripted((n, req) => {
    if (req.responseFormat?.type === "json") return JSON.stringify({ severity: "high", summary: "Printer on fire" });
    if (n === 0)
      return {
        tools: [
          { name: "lookupTicket", input: { id: "T-1" } },
          { name: "purgeTicket", input: { id: "T-1" } },
        ],
      };
    return `Looked it up. Purge said: ${lastTool(req).includes("purging is disabled") ? "blocked" : "?"}`;
  });
  executed: string[] = [];
  bodies: string[] = [];
  verdictTurn = false;

  override getModel() {
    return this.mock.model;
  }
  override getSystemPrompt() {
    return "You are the help desk.";
  }
  override getTools() {
    return {
      lookupTicket: tool({
        description: "Read a ticket",
        inputSchema: z.object({ id: z.string() }),
        execute: async ({ id }) => {
          this.executed.push(`lookup:${id}`);
          return { id, title: "Printer on fire" };
        },
      }),
      purgeTicket: tool({
        description: "Delete a ticket",
        inputSchema: z.object({ id: z.string() }),
        execute: async ({ id }) => {
          this.executed.push(`purge:${id}`);
          return { purged: id };
        },
      }),
    };
  }
  override beforeToolCall(ctx: ToolCallContext): ToolCallDecision | undefined {
    if (ctx.toolName === "purgeTicket") return { action: "block", reason: "purging is disabled" };
  }
  override beforeTurn(ctx: TurnContext) {
    this.bodies.push(JSON.stringify(ctx.body ?? null));
    if (this.verdictTurn || ctx.body?.mode === "verdict")
      return { output: Output.object({ schema: Verdict }), activeTools: [] };
  }

  async ask(text: string, opts: { body?: Record<string, unknown>; verdict?: boolean } = {}) {
    this.verdictTurn = opts.verdict ?? false;
    const r = await this.runTurn({ input: text, body: opts.body });
    return { status: r.status, output: r.output, text: JSON.stringify(r.message?.parts ?? []) };
  }
  report() {
    const first = this.mock.requests[0];
    return {
      executed: this.executed,
      calls: this.mock.requests.length,
      system:
        first?.prompt
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n") ?? "",
      tools: (first?.tools ?? []).map((t) => t.name).sort(),
      lastTools: (this.mock.requests.at(-1)?.tools ?? []).map((t) => t.name),
      bodies: this.bodies,
      lastFormat: this.mock.requests.at(-1)?.responseFormat?.type,
    };
  }
}

export async function test(env: Env, _h: Harness) {
  const agent = rpc<HelpDesk>(await getAgentByName(env.HelpDesk, "desk"));
  const turn = await agent.ask("What is ticket T-1 about? Then purge it.");
  check(turn.status === "completed", `runTurn waits for the turn to finish (status ${turn.status})`);
  let r = await agent.report();
  check(r.system.includes("You are the help desk."), "getSystemPrompt() reaches the model as a system message");
  check(r.tools.includes("lookupTicket") && r.tools.includes("purgeTicket"), "getTools() tools are offered");
  console.log(`  tools offered on turn 1: ${r.tools.join(", ")}`);
  check(r.executed.join() === "lookup:T-1", "the allowed tool ran; the blocked tool's execute never ran");
  check(turn.text.includes("Purge said: blocked"), "the model saw the block reason as the tool's output");

  // Surprise: RunTurnWait accepts `body`, but think.js forwards it to beforeTurn only for
  // continuation turns, so a body-gated beforeTurn (the docs' pattern) never fires here.
  const ignored = await agent.ask("Classify ticket T-1.", { body: { mode: "verdict" } });
  r = await agent.report();
  check(r.bodies.at(-1) === "null", "runTurn({ input, body }) does not pass body to beforeTurn's ctx.body");
  check(ignored.output === undefined && r.lastTools.length > 0, "so that turn ran without structured output");

  const verdict = await agent.ask("Classify ticket T-1.", { verdict: true });
  r = await agent.report();
  check(r.lastTools.length === 0, "beforeTurn's activeTools: [] removed every tool for the structured turn");
  check(r.lastFormat === "json", "beforeTurn's output asked the model for JSON");
  const out = verdict.output as z.infer<typeof Verdict> | undefined;
  check(verdict.status === "completed" && out?.severity === "high", "TurnResult.output holds the parsed object");
}
