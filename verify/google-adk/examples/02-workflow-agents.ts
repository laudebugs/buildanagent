// The workflow agents: SequentialAgent runs sub-agents in order and passes data through session state
// (outputKey plus {key} templating), ParallelAgent runs every sub-agent on its own branch, and LoopAgent
// repeats until maxIterations or until a tool sets `escalate`. All three are deprecated in 2.5.0 in favour
// of Workflow and say so at construction.
// Docs: docs/agents/workflow-agents/{sequential,parallel,loop}-agents.md; the deprecation note at line 17.
import type { Logger } from "@google/adk";
import { EXIT_LOOP, InMemoryRunner, LlmAgent, LoopAgent, ParallelAgent, SequentialAgent, setLogger } from "@google/adk";
import { afterTool, callTool, check, ScriptedLlm, say, turn } from "./lib/check.ts";

const warnings: string[] = [];
const quiet = () => {};
setLogger({
  log: quiet,
  debug: quiet,
  info: quiet,
  warn: (...m: unknown[]) => warnings.push(m.join(" ")),
  error: quiet,
  setLogLevel: quiet,
} satisfies Logger);

const system = (m: ScriptedLlm, i = 0) => String(m.requests[i]?.config?.systemInstruction ?? "");

// Sequential: the writer's output lands in state.draft, and the reviewer's instruction reads {draft}.
{
  // #region sequential
  const writerModel = new ScriptedLlm(() => say("DRAFT-TEXT"));
  const reviewerModel = new ScriptedLlm(() => say("LGTM"));
  const writer = new LlmAgent({ name: "writer", model: writerModel, instruction: "Write.", outputKey: "draft" });
  const reviewer = new LlmAgent({ name: "reviewer", model: reviewerModel, instruction: "Review this: {draft}" });
  const pipeline = new SequentialAgent({ name: "pipeline", subAgents: [writer, reviewer] });
  const runner = new InMemoryRunner({ agent: pipeline, appName: "seq" });
  const s = await runner.sessionService.createSession({ appName: "seq", userId: "u1" });
  const events = await turn(runner, s.id, "Write a haiku.");
  // #endregion
  check(events.map((e) => e.author).join() === "writer,reviewer", "SequentialAgent runs its sub-agents in order");
  check(
    system(reviewerModel).includes("Review this: DRAFT-TEXT"),
    "outputKey writes state that {draft} injects into the next instruction",
  );
  const after = await runner.sessionService.getSession({ appName: "seq", userId: "u1", sessionId: s.id });
  check(after?.state.draft === "DRAFT-TEXT", "the outputKey value persists in session state");
}

// Parallel: both sub-agents run, each on its own branch, and neither sees the other's reply.
{
  const aModel = new ScriptedLlm(() => say("A-RESULT"));
  const bModel = new ScriptedLlm(() => say("B-RESULT"));
  const a = new LlmAgent({ name: "a", model: aModel, instruction: "A", outputKey: "a_out" });
  const b = new LlmAgent({ name: "b", model: bModel, instruction: "B", outputKey: "b_out" });
  const fan = new ParallelAgent({ name: "fan", subAgents: [a, b] });
  const runner = new InMemoryRunner({ agent: fan, appName: "par" });
  const s = await runner.sessionService.createSession({ appName: "par", userId: "u1" });
  const events = await turn(runner, s.id, "Go.");
  check(new Set(events.map((e) => e.author)).size === 2, "ParallelAgent runs every sub-agent");
  const branches = events.map((e) => e.branch);
  check(
    branches.includes("fan.a") && branches.includes("fan.b"),
    "each parallel sub-agent runs on its own branch (fan.a, fan.b)",
  );
  check(
    !JSON.stringify(bModel.requests[0].contents).includes("A-RESULT"),
    "a parallel sibling's reply is not in the other's context",
  );
  const after = await runner.sessionService.getSession({ appName: "par", userId: "u1", sessionId: s.id });
  check(
    after?.state.a_out === "A-RESULT" && after?.state.b_out === "B-RESULT",
    "both branches write to the shared session state",
  );
}

// Loop: maxIterations bounds the loop; exit_loop (escalate) ends it early.
{
  // #region loop
  const model = new ScriptedLlm(() => say("again"));
  const step = new LlmAgent({ name: "step", model, instruction: "Iterate." });
  const loop = new LoopAgent({ name: "loop", subAgents: [step], maxIterations: 3 });
  // #endregion
  const runner = new InMemoryRunner({ agent: loop, appName: "loop" });
  const s = await runner.sessionService.createSession({ appName: "loop", userId: "u1" });
  await turn(runner, s.id, "Go.");
  check(model.requests.length === 3, "LoopAgent stops after maxIterations (3 model calls)");

  // The second iteration calls exit_loop, which sets actions.escalate.
  let iteration = 0;
  const exitModel = new ScriptedLlm((req) => {
    if (afterTool(req)) return say("stopping");
    iteration++;
    return iteration === 2 ? callTool("exit_loop") : say(`pass ${iteration}`);
  });
  const stepper = new LlmAgent({ name: "stepper", model: exitModel, instruction: "Iterate.", tools: [EXIT_LOOP] });
  const early = new LoopAgent({ name: "early", subAgents: [stepper], maxIterations: 10 });
  const r2 = new InMemoryRunner({ agent: early, appName: "loop2" });
  const s2 = await r2.sessionService.createSession({ appName: "loop2", userId: "u1" });
  const events = await turn(r2, s2.id, "Go.");
  check(iteration === 2, "exit_loop ends the loop in the iteration that calls it");
  check(
    events.some((e) => e.actions.escalate),
    "the exit_loop tool result carries actions.escalate",
  );
}

check(
  ["SequentialAgent", "ParallelAgent", "LoopAgent"].every((c) =>
    warnings.some((w) => w.includes(`${c} is deprecated in favor of Workflow`)),
  ),
  "constructing each workflow agent logs a deprecation warning pointing to Workflow",
);
