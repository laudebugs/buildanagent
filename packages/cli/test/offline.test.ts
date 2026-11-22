// Nothing leaves the machine unless a flag says where: no update check, no telemetry, and spans only to the
// collector --otlp-endpoint names.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import { cli, reply, scripted, stateDir, terminal } from "./cli-helpers.js";

let cleanup: () => void = () => undefined;
let dir = "";
let calls: string[] = [];

beforeEach(() => {
  const state = stateDir();
  ({ cleanup, dir } = state);
  calls = [];
  // Record every fetch, then refuse it, so a call that would leave the machine is seen even before the guard.
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    calls.push(String(input instanceof Request ? input.url : input));
    throw new Error("no connection in this test");
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

test("with no flags, run, chat and every sessions command open no outbound connection", async () => {
  const run = terminal();
  assert.equal(await cli(run, dir, ["run", "Hello"], { model: scripted([reply("Hi.")]).model }), 0);
  const session = /^session (\S+)/.exec(run.stderr.join(""))?.[1] as string;
  assert.equal(await cli(terminal(["Again"]), dir, ["chat"], { model: scripted([reply("Hi again.")]).model }), 0);
  for (const argv of [
    ["sessions", "list"],
    ["sessions", "show", session],
    ["sessions", "replay", session],
  ]) {
    assert.equal(await cli(terminal(), dir, argv), 0, argv.join(" "));
  }
  assert.equal(await cli(terminal(), dir, ["sessions", "search", "Hi"]), 0);
  assert.equal(await cli(terminal(), dir, ["--help"]), 0);
  assert.deepEqual(calls, []);
});

test("--otlp-endpoint sends the run's spans, without content, to that collector alone", async () => {
  const sent: { url: string; body: string }[] = [];
  const collector: typeof fetch = async (input, init) => {
    sent.push({ url: String(input), body: String(init?.body) });
    return new Response(null, { status: 200 });
  };
  const term = terminal();
  const { model } = scripted([reply("A secret answer.")]);
  const status = await cli(term, dir, ["run", "--otlp-endpoint", "http://127.0.0.1:4318", "A secret question"], {
    model,
    fetch: collector,
  });
  assert.equal(status, 0);
  assert.deepEqual(calls, []);
  assert.deepEqual(
    sent.map(({ url }) => url),
    ["http://127.0.0.1:4318/v1/traces"],
  );
  const [{ body } = { body: "" }] = sent;
  const spans = JSON.parse(body).resourceSpans[0].scopeSpans[0].spans as { name: string; parentSpanId?: string }[];
  assert.ok(spans.some((span) => span.name.startsWith("invoke_agent")));
  assert.ok(spans.some((span) => span.parentSpanId !== undefined));
  assert.doesNotMatch(body, /secret/);
});

test("a collector that refuses the spans makes the command exit 2 with the status it answered", async () => {
  const term = terminal();
  const status = await cli(term, dir, ["run", "--otlp-endpoint", "http://127.0.0.1:4318/v1/traces", "Hi"], {
    model: scripted([reply("Hi.")]).model,
    fetch: async () => new Response(null, { status: 503 }),
  });
  assert.equal(status, 2);
  assert.match(term.stderr.join(""), /the OTLP endpoint answered 503/);
});
