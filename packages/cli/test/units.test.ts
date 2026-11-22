// The pure parts: the command line, chained commands, the meter's 80% warnings, line splitting and model specs.
import assert from "node:assert/strict";
import { linesOf } from "@buildanagent/cli";
import type { SessionEntry } from "@buildanagent/protocol";
import { describe, test } from "vitest";
import { parseArgs } from "../src/args.js";
import { chainedCommands } from "../src/command-lines.js";
import { Meter, readingText, warningText } from "../src/meter.js";
import { modelFromSpec } from "../src/model.js";

describe("parseArgs", () => {
  test("flags go anywhere, take a value after a space or an equals sign, and -- ends them", () => {
    const { positionals, flags } = parseArgs(["run", "--json", "--model=anthropic:m", "--budget", "2", "--", "--x"]);
    assert.deepEqual(positionals, ["run", "--x"]);
    assert.equal(flags.json, true);
    assert.equal(flags.model, "anthropic:m");
    assert.equal(flags.budgetUsd, 2);
  });

  test("an unknown flag, a missing value and a budget that is not positive are usage errors", () => {
    assert.throws(() => parseArgs(["--nope"]), /unknown flag "--nope"/);
    assert.throws(() => parseArgs(["--model"]), /--model needs a value/);
    assert.throws(() => parseArgs(["--budget", "0"]), /--budget takes a positive number/);
  });
});

describe("chainedCommands", () => {
  test("splits at list and pipe operators and normalises the spaces outside quotes", () => {
    assert.deepEqual(chainedCommands("a   b && c || d | e; f & g\nh"), [
      { operator: "", command: "a b" },
      { operator: "&&", command: "c" },
      { operator: "||", command: "d" },
      { operator: "|", command: "e" },
      { operator: ";", command: "f" },
      { operator: "&", command: "g" },
      { operator: ";", command: "h" },
    ]);
  });

  test("leaves operators inside quotes, escapes and substitutions alone", () => {
    assert.deepEqual(chainedCommands(`echo "a && b" 'c | d' e\\;f $(g; h) \`i && j\``), [
      { operator: "", command: `echo "a && b" 'c | d' e\\;f $(g; h) \`i && j\`` },
    ]);
  });
});

const usage = (total: number | null): SessionEntry =>
  ({ type: "usage", cost: { total, basis: "catalog", currency: "USD" } }) as unknown as SessionEntry;

describe("Meter", () => {
  test("warns once when the context passes 80% of its budget", () => {
    const meter = new Meter();
    assert.deepEqual(meter.observe({ type: "context_fill", tokens: 79, budget: 100 }), []);
    const [note] = meter.observe({ type: "context_fill", tokens: 80, budget: 100 });
    assert.equal(warningText(note as never), "warning: the context is 80% full (80 of 100 tokens)");
    assert.deepEqual(meter.observe({ type: "context_fill", tokens: 95, budget: 100 }), []);
  });

  test("sums priced calls, counts unpriced ones, and warns once at 80% of the budget", () => {
    const meter = new Meter(1);
    assert.deepEqual(meter.observe({ type: "entry_appended", entry: usage(0.5) }), []);
    assert.deepEqual(meter.observe({ type: "entry_appended", entry: usage(null) }), []);
    const [note] = meter.observe({ type: "entry_appended", entry: usage(0.3) });
    assert.equal(warningText(note as never), "warning: this session has spent $0.8000, 80% of its $1.0000 budget");
    assert.deepEqual(meter.observe({ type: "entry_appended", entry: usage(0.1) }), []);
    assert.equal(readingText(meter.reading()), "cost $0.9000 (+1 unpriced)");
  });
});

test("linesOf splits text and bytes at line breaks, across chunks, and keeps a last line without one", async () => {
  async function* chunks() {
    yield "one\r\ntw";
    yield new TextEncoder().encode("o\nthree");
  }
  const lines: string[] = [];
  for await (const line of linesOf(chunks())) lines.push(line);
  assert.deepEqual(lines, ["one", "two", "three"]);
});

test("modelFromSpec builds a model for a known provider whose key is set, and refuses an unknown provider", () => {
  const model = modelFromSpec("anthropic:claude-sonnet-5-5", { ANTHROPIC_API_KEY: "sk-test-not-a-real-key" });
  assert.deepEqual([model.ref.provider, model.ref.id], ["anthropic", "claude-sonnet-5-5"]);
  assert.throws(() => modelFromSpec("acme:m", {}), /--model takes anthropic:<model id> or openai:<model id>/);
  assert.throws(() => modelFromSpec("openai:gpt-x", {}), /OPENAI_API_KEY, which is not set/);
});
