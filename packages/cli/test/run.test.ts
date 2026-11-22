// `buildanagent run`: one turn, its events as JSON lines or its answer as text, and an exit status scripts can read.
import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { callTool, cli, jsonLines, recordingTool, reply, scripted, stateDir, terminal } from "./cli-helpers.js";

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
});
const fresh = () => {
  const state = stateDir();
  cleanups.push(state.cleanup);
  return state.dir;
};

test("run --json prints one JSON object per line and exits 0 on done", async () => {
  const dir = fresh();
  const term = terminal();
  const { model, adapter } = scripted([reply("The build is green.")]);
  const status = await cli(term, dir, ["run", "--json", "Is the build green?"], { model });
  assert.equal(status, 0);
  adapter.assertComplete();
  assert.equal(term.stderr.join(""), "");
  const lines = term.lines();
  assert.ok(lines.length > 3);
  const objects = jsonLines(term);
  assert.equal(objects[0]?.type, "session");
  assert.equal(typeof objects[0]?.preambleTokens, "number");
  const last = objects.at(-1) as { type: string; result: { stopReason: string } };
  assert.equal(last.type, "settled");
  assert.equal(last.result.stopReason, "done");
  const events = objects.filter((object) => object.type === "event") as { event: { type: string; delta?: string } }[];
  const text = events.flatMap(({ event }) => (event.type === "text_delta" ? [event.delta] : [])).join("");
  assert.equal(text, "The build is green.");
  assert.ok(events.some(({ event }) => event.type === "entry_appended"));
});

test("run without --json prints the answer on standard output and the session and meter on standard error", async () => {
  const dir = fresh();
  const term = terminal();
  const status = await cli(term, dir, ["run", "Is", "the", "build", "green?"], {
    model: scripted([reply("Yes.")]).model,
  });
  assert.equal(status, 0);
  assert.equal(term.stdout.join(""), "Yes.\n");
  const stderr = term.stderr.join("");
  assert.match(stderr, /^session \S+ · preamble ~\d+ tokens \(system prompt and 0 tools\)\n/);
  assert.match(stderr, /\[done\] context \d+% \(\d+ of \d+ tokens\) · cost \$0\.0000 \(\+1 unpriced\)\n$/);
});

test("run reports a tool call and its result on standard error", async () => {
  const dir = fresh();
  const term = terminal();
  const ran: unknown[] = [];
  const { model } = scripted([{ content: [callTool("c1", "lookup", { order: "o1" })] }, reply("Found it.")]);
  const status = await cli(term, dir, ["run", "Find o1"], {
    model,
    tools: [recordingTool("lookup", ran)],
    rules: { allow: [{ tool: "lookup" }] },
  });
  assert.equal(status, 0);
  assert.deepEqual(ran, [{ order: "o1" }]);
  assert.match(term.stderr.join(""), /· lookup \{"order":"o1"\}\n {2}lookup → lookup done\n/);
});

test("run exits 3 and names resume when a call waits for approval, and runs nothing", async () => {
  const dir = fresh();
  const term = terminal();
  const ran: unknown[] = [];
  const { model } = scripted([{ content: [callTool("c1", "refund", { order: "o1" })] }]);
  const status = await cli(term, dir, ["run", "Refund o1"], {
    model,
    tools: [recordingTool("refund", ran)],
    rules: { ask: [{ tool: "refund" }] },
  });
  assert.equal(status, 3);
  assert.deepEqual(ran, []);
  assert.match(term.stderr.join(""), /\[awaiting_approval\] .* · answer with: buildanagent resume \S+\n$/);
});

test("run with no --model and no model given exits 2 and says how to name one", async () => {
  const term = terminal();
  const status = await cli(term, fresh(), ["run", "Hi"]);
  assert.equal(status, 2);
  assert.match(term.stderr.join(""), /pass --model <provider>:<model id>/);
});

test("run --model with an unset key exits 2 and names the variable", async () => {
  const term = terminal();
  const status = await cli(term, fresh(), ["run", "--model", "anthropic:claude-sonnet-5-5", "Hi"]);
  assert.equal(status, 2);
  assert.match(term.stderr.join(""), /reads its key from ANTHROPIC_API_KEY, which is not set/);
});

test("run with no prompt is a usage error that prints the help", async () => {
  const term = terminal();
  assert.equal(await cli(term, fresh(), ["run"]), 2);
  assert.match(term.stderr.join(""), /^buildanagent: run needs a prompt.*\n\nUsage: buildanagent/);
});
