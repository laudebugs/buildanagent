// The 2.x graph runtime: a Workflow wires nodes (plain functions, LlmAgents) with edges from START, passes
// each node's output to the next node as input, routes on an event's `route`, fans out and joins with a
// JoinNode, and pauses for a human on RequestInput, resuming on the next user message. No model is needed
// for function nodes.
// Docs: docs/graphs/index.md, docs/graphs/routes.md, docs/graphs/human-input.md; snippets under
// examples/typescript/snippets/graphs/.
import type { Event, NodeContext } from "@google/adk";
import { createEvent, InMemoryRunner, JoinNode, LlmAgent, node, RequestInput, Workflow } from "@google/adk";
import { check, ScriptedLlm, say, turn } from "./lib/check.ts";

const finalOutput = (events: Event[]) => events.filter((e) => e.output !== undefined).at(-1)?.output;
const session = async (runner: InMemoryRunner) =>
  (await runner.sessionService.createSession({ appName: runner.appName, userId: "u1" })).id;

// Sequence: START -> trim -> upper. Each node's return value is the next node's input.
{
  const trim = node((_ctx: NodeContext, input: string) => input.trim(), { name: "trim" });
  const upper = node((_ctx: NodeContext, input: string) => input.toUpperCase(), { name: "upper" });
  const wf = new Workflow({ name: "seq", edges: [["START", trim, upper]] });
  const runner = new InMemoryRunner({ agent: wf, appName: "seq" });
  const events = await turn(runner, await session(runner), "  hello  ");
  check(finalOutput(events) === "HELLO", "a node's return value is the next node's input (START gets the user text)");
}

// Routing: a node emits createEvent({route}) and the edge map picks the target; an LlmAgent is a node too.
{
  // #region routing
  const model = new ScriptedLlm(() => say("from the agent"));
  const agentNode = new LlmAgent({ name: "words", model, instruction: "Reply." });
  const digits = node(() => "digits branch", { name: "digits" });
  const router = node(
    (_ctx: NodeContext, input: string) => createEvent({ route: /\d/.test(input) ? "DIGITS" : "WORDS", output: input }), // book:note route
    { name: "router" },
  );
  const wf = new Workflow({
    name: "route",
    edges: [
      ["START", router],
      [router, { DIGITS: digits, WORDS: agentNode }], // book:note edges
    ],
  });
  // #endregion
  const runner = new InMemoryRunner({ agent: wf, appName: "route" });
  const digitsRun = await turn(runner, await session(runner), "order 42");
  check(
    finalOutput(digitsRun) === "digits branch" && model.requests.length === 0,
    "route DIGITS runs only the digits node",
  );
  const wordsRun = await turn(runner, await session(runner), "hello");
  check(Number(model.requests.length) === 1, "route WORDS runs the LlmAgent node");
  check(
    wordsRun.some((e) => e.author === "words" && e.content?.parts?.[0]?.text === "from the agent"),
    "the agent node's reply is an event",
  );
}

// Fan-out and join: three branches from START, a JoinNode collects their outputs by node name.
{
  const a = node((_c: NodeContext, t: string) => t.toUpperCase(), { name: "a" });
  const b = node((_c: NodeContext, t: string) => t.length, { name: "b" });
  const c = node((_c: NodeContext, t: string) => [...t].reverse().join(""), { name: "c" });
  const join = new JoinNode({ name: "join" });
  const done = node((_c: NodeContext, r: Record<string, unknown>) => `${r.a}|${r.b}|${r.c}`, { name: "done" });
  const wf = new Workflow({
    name: "fan",
    edges: [
      ["START", a, join],
      ["START", b, join],
      ["START", c, join],
      [join, done],
    ],
  });
  const runner = new InMemoryRunner({ agent: wf, appName: "fan" });
  const events = await turn(runner, await session(runner), "abc");
  check(finalOutput(events) === "ABC|3|cba", "JoinNode waits for every branch and passes {nodeName: output}");
}

// Human input: RequestInput pauses the run; the next user message resumes it as the node's answer.
{
  let resumed = 0;
  const ask = node(
    async function* () {
      yield new RequestInput({ message: "Enter a number:" });
    },
    { name: "ask" },
  );
  const double = node(
    (_c: NodeContext, input: string) => {
      resumed++;
      return Number(input) * 2;
    },
    { name: "double" },
  );
  const wf = new Workflow({ name: "hitl", edges: [["START", ask, double]] });
  const runner = new InMemoryRunner({ agent: wf, appName: "hitl" });
  const id = await session(runner);
  const first = await turn(runner, id, "start");
  const paused = first.find((e) => (e.longRunningToolIds?.length ?? 0) > 0);
  check(paused !== undefined && resumed === 0, "RequestInput pauses the workflow with a long-running call");
  check(
    paused?.content?.parts?.some((p) => p.functionCall?.name === "adk_request_input"),
    "the pause is an adk_request_input function call",
  );
  const second = await turn(runner, id, "21");
  check(
    finalOutput(second) === 42 && Number(resumed) === 1,
    "the next user message resumes the paused node with that text",
  );
}
