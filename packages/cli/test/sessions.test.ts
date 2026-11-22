// `buildanagent sessions`: list, show, search and replay read the stored log, and a replay makes no model call.
import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { callTool, cli, jsonLines, recordingTool, reply, scripted, stateDir, terminal } from "./cli-helpers.js";

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
});

/** A state folder holding one session: a question about a flaky test, a lookup and an answer. */
async function recorded(): Promise<{ dir: string; session: string }> {
  const state = stateDir();
  cleanups.push(state.cleanup);
  const term = terminal();
  const { model } = scripted([
    { content: [callTool("c1", "lookup", { test: "login" })] },
    reply("The login test is flaky because it waits on a real clock."),
  ]);
  const status = await cli(term, state.dir, ["run", "--json", "Why does the login test fail?"], {
    model,
    tools: [recordingTool("lookup", [])],
    rules: { allow: [{ tool: "lookup" }] },
  });
  assert.equal(status, 0);
  const [first] = jsonLines(term);
  return { dir: state.dir, session: first?.session as string };
}

test("sessions list prints each stored session, and --json one object per session", async () => {
  const { dir, session } = await recorded();
  const text = terminal();
  assert.equal(await cli(text, dir, ["sessions", "list"]), 0);
  assert.match(text.stdout.join(""), new RegExp(`^${session}  started \\S+  last \\S+  \\d+ entries\\n$`));
  const json = terminal();
  assert.equal(await cli(json, dir, ["sessions", "list", "--json"]), 0);
  assert.deepEqual(
    jsonLines(json).map((item) => item.session),
    [session],
  );
});

test("sessions list says so when there are no sessions", async () => {
  const state = stateDir();
  cleanups.push(state.cleanup);
  const term = terminal();
  assert.equal(await cli(term, state.dir, ["sessions", "list"]), 0);
  assert.equal(term.stdout.join(""), "");
  assert.equal(term.stderr.join(""), "no sessions yet\n");
});

test("sessions search finds a message in a recorded session", async () => {
  const { dir, session } = await recorded();
  const term = terminal();
  assert.equal(await cli(term, dir, ["sessions", "search", "REAL", "clock"]), 0);
  const [line, ...rest] = term.lines();
  assert.deepEqual(rest, []);
  assert.match(
    line ?? "",
    new RegExp(`^${session} #\\d+ assistant: The login test is flaky because it waits on a real clock\\.$`),
  );
  const json = terminal();
  assert.equal(await cli(json, dir, ["sessions", "search", "--json", "login test fail"]), 0);
  assert.deepEqual(
    jsonLines(json).map(({ who, session: id }) => [id, who]),
    [[session, "you"]],
  );
});

test("sessions search cuts its snippet around the match when lower case would change the text's length", async () => {
  const state = stateDir();
  cleanups.push(state.cleanup);
  // \u0130 lowers to two code units, so a match found in lowered text sits further right than in the original.
  const answer = `${"\u0130".repeat(100)} needle ${"x".repeat(200)}`;
  assert.equal(await cli(terminal(), state.dir, ["run", "Hi"], { model: scripted([reply(answer)]).model }), 0);
  const term = terminal();
  assert.equal(await cli(term, state.dir, ["sessions", "search", "NEEDLE"]), 0);
  const [line] = term.lines();
  assert.match(line ?? "", /: …\u0130{59} needle x{59}…$/);
  const exact = terminal();
  assert.equal(await cli(exact, state.dir, ["sessions", "search", "\u0130\u0130 needle"]), 0);
  assert.equal(exact.lines().length, 1);
});

test("sessions search exits 1 when no message holds the text", async () => {
  const { dir } = await recorded();
  const term = terminal();
  assert.equal(await cli(term, dir, ["sessions", "search", "database"]), 1);
  assert.equal(term.stderr.join(""), 'no message holds "database"\n');
});

test("sessions replay plays a session back with zero model calls", async () => {
  const { dir, session } = await recorded();
  const term = terminal();
  // A model with no steps throws on any call, so a replay that called one would fail here.
  const { model, adapter } = scripted([]);
  assert.equal(await cli(term, dir, ["sessions", "replay", session], { model }), 0);
  assert.equal(adapter.calls.length, 0);
  assert.deepEqual(term.lines(), [
    "you: Why does the login test fail?",
    '· lookup {"test":"login"}',
    "  lookup → lookup done",
    "assistant: The login test is flaky because it waits on a real clock.",
    "[turn ended: done after 2 steps]",
  ]);
  assert.match(term.stderr.join(""), /^\[replayed \d+ entries\] cost \$0\.0000 \(\+2 unpriced\)\n$/);
});

test("sessions replay --json prints the entries as the events a live run streams", async () => {
  const { dir, session } = await recorded();
  const term = terminal();
  assert.equal(await cli(term, dir, ["sessions", "replay", "--json", session]), 0);
  const objects = jsonLines(term);
  const events = objects.filter((object) => object.type === "event") as { seq: number; event: { type: string } }[];
  assert.ok(events.length > 5);
  assert.ok(events.every(({ event }) => event.type === "entry_appended"));
  assert.deepEqual(
    events.map(({ seq }) => seq),
    events.map((_, index) => index),
  );
  assert.equal(objects.at(-1)?.type, "replayed");
});

test("sessions show prints every entry with its sequence number and type", async () => {
  const { dir, session } = await recorded();
  const term = terminal();
  assert.equal(await cli(term, dir, ["sessions", "show", session]), 0);
  const lines = term.lines();
  assert.equal(lines[0], "#0 session_header");
  assert.ok(lines.some((line) => /^#\d+ tool_result {2}lookup → lookup done$/.test(line)));
  assert.match(term.stderr.join(""), new RegExp(`^session ${session}: ${lines.length} entries\\n$`));
});

test("sessions show of an unknown session exits 2", async () => {
  const { dir } = await recorded();
  const term = terminal();
  assert.equal(await cli(term, dir, ["sessions", "show", "missing"]), 2);
  assert.match(term.stderr.join(""), /no session "missing"/);
});

test("sessions with no subcommand is a usage error", async () => {
  const { dir } = await recorded();
  const term = terminal();
  assert.equal(await cli(term, dir, ["sessions"]), 2);
  assert.match(term.stderr.join(""), /sessions takes list, show <session>, search <text> or replay <session>/);
});
