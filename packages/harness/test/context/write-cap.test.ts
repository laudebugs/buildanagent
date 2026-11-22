// Layer 1: a tool result over the cap reaches the model cut, with a pointer to a spill file that holds all of it.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isHarnessError } from "@buildanagent/harness";
import { createContextPolicy, memorySpillStore } from "@buildanagent/harness/context";
import { fileSpillStore } from "@buildanagent/harness/context/file";
import { describe, test } from "vitest";
import { call, runScripted } from "./helpers.js";

const done = { content: [{ type: "text" as const, text: "Done." }] };
const KIB = 1024;

const resultText = (adapter: { calls: readonly { context: { messages: readonly unknown[] } }[] }): string => {
  const last = adapter.calls.at(-1)?.context.messages.findLast((m) => (m as { role: string }).role === "tool") as
    | { content: { type: string; text: string }[] }
    | undefined;
  return last?.content.map((block) => block.text).join("") ?? "";
};

describe("the write cap", () => {
  test("a 200 KiB result reaches the model as at most 64 KiB plus a spill path, and the spill holds the full text", async () => {
    const spill = memorySpillStore();
    const { adapter, entries } = await runScripted([call("c1", 200 * KIB), done], createContextPolicy({ spill }));
    const seen = resultText(adapter);
    assert.ok(seen.length <= 64 * KIB, `the model read ${seen.length} characters`);
    const entry = entries.find((e) => e.type === "tool_result");
    assert.ok(entry?.type === "tool_result" && entry.spill !== undefined);
    assert.equal(entry.spill.bytes, 200 * KIB);
    assert.ok(seen.includes(entry.spill.path));
    assert.equal(spill.read(entry.spill.path)?.length, 200 * KIB);
    // The log stores what the model saw.
    assert.equal(entry.content.map((block) => (block.type === "text" ? block.text : "")).join(""), seen);
  });

  test("a result of newlines is cut by its escaped size, so the stored entry stays within the store's bound", async () => {
    const { entries } = await runScripted(
      [call("c1", 40 * KIB), done],
      createContextPolicy({ spill: memorySpillStore() }),
      (_id, size) => "\n".repeat(size),
    );
    const entry = entries.find((e) => e.type === "tool_result");
    assert.ok(entry?.type === "tool_result" && entry.spill !== undefined);
    assert.equal(entry.spill.bytes, 40 * KIB);
  });

  test("a result under the cap is untouched and has no spill", async () => {
    const { adapter, entries } = await runScripted(
      [call("c1", 1000), done],
      createContextPolicy({ spill: memorySpillStore() }),
    );
    assert.equal(resultText(adapter).length, 1000);
    const entry = entries.find((e) => e.type === "tool_result");
    assert.ok(entry?.type === "tool_result" && entry.spill === undefined);
  });

  test("the cut never splits a multibyte character", async () => {
    // Each cap cuts `é` (two bytes) at an even or an odd byte, so one of them lands inside a character.
    for (const writeCapBytes of [1500, 1501, 1502, 1503]) {
      const { adapter } = await runScripted(
        [call("c1", 4000), done],
        createContextPolicy({ spill: memorySpillStore(), writeCapBytes }),
        () => "é".repeat(4000),
      );
      const seen = resultText(adapter);
      assert.ok(!seen.includes("\uFFFD"), `cap ${writeCapBytes} split a character`);
      assert.ok(seen.startsWith("éé"));
    }
  });

  test("with the layer off, nothing is cut and no spill store is needed", async () => {
    const { adapter } = await runScripted(
      [call("c1", 30 * KIB), done],
      createContextPolicy({ writeCapBytes: 10 * KIB, layers: { write_cap: false } }),
    );
    assert.equal(resultText(adapter).length, 30 * KIB);
  });

  test("a policy with the layer on and no spill store is refused", () => {
    assert.throws(
      () => createContextPolicy(),
      (error: unknown) => isHarnessError(error) && error.code === "invalid_context_options",
    );
  });

  test("the file spill store writes one file per call", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-spill-"));
    try {
      const { entries } = await runScripted(
        [call("c1", 100 * KIB), done],
        createContextPolicy({ spill: fileSpillStore({ dir }) }),
      );
      const entry = entries.find((e) => e.type === "tool_result");
      assert.ok(entry?.type === "tool_result" && entry.spill !== undefined);
      assert.ok(entry.spill.path.startsWith(dir));
      assert.equal(readFileSync(entry.spill.path, "utf8").length, 100 * KIB);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the spill file is named by the run, so a reused call id keeps both results", async () => {
    const spill = memorySpillStore();
    const { entries } = await runScripted([call("c1", 100 * KIB), done], createContextPolicy({ spill }));
    const start = entries.find((e) => e.type === "turn_start");
    const entry = entries.find((e) => e.type === "tool_result");
    assert.ok(start?.type === "turn_start" && entry?.type === "tool_result" && entry.spill !== undefined);
    assert.ok(entry.spill.path.includes(start.runId));
  });

  test("details that would crowd out the text are replaced by a note, so the entry still fits", async () => {
    const { entries } = await runScripted(
      [call("c1", 40 * KIB), done],
      createContextPolicy({ spill: memorySpillStore() }),
      (_id, size) => "x".repeat(size),
      { big: "d".repeat(30 * KIB) },
    );
    const entry = entries.find((e) => e.type === "tool_result");
    assert.ok(entry?.type === "tool_result" && entry.spill !== undefined);
    assert.deepEqual(entry.details, { omitted: "the result's details were over the entry bound" });
  });

  test("a budget that is not a positive whole number is refused", () => {
    assert.throws(
      () => createContextPolicy({ spill: memorySpillStore(), budgetTokens: 0 }),
      (error: unknown) => isHarnessError(error) && error.code === "invalid_context_options",
    );
  });
});
