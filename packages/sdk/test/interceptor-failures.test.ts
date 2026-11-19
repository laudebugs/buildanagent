// What a throwing interceptor does: fail closed by default, skip the hook with onFailure "continue", and read-only inputs.
import assert from "node:assert/strict";
import type { Interceptors } from "@buildanagent/sdk";
import { test } from "vitest";
import { drivenRun } from "./hook-helpers.js";
import { lookup, text, toolCall } from "./run-helpers.js";

function boom(): never {
  throw new Error("boom");
}

// Each hook that is not a gate, with a script whose run reaches it.
const HOOKS: [keyof Interceptors, Interceptors][] = [
  ["transformContext", { transformContext: boom }],
  ["beforeModelCall", { beforeModelCall: boom }],
  ["afterModelCall", { afterModelCall: boom }],
  ["shouldStop", { shouldStop: boom }],
];

for (const [name, interceptors] of HOOKS) {
  test(`a ${name} that throws ends the run with an error result of kind hook`, async () => {
    const { events, result } = await drivenRun([toolCall("lookup", { order: 1 }), text("Done.")], interceptors, {
      tools: [lookup],
    });
    assert.equal(result.stopReason, "error");
    assert.deepEqual(result.stopReason === "error" ? result.error.kind : undefined, "hook");
    assert.match(result.stopReason === "error" ? result.error.message : "", new RegExp(`${name} hook failed: boom`));
    assert.ok(events.some((event) => event.type === "hook_error" && event.hook === name));
  });

  test(`a ${name} that throws with onFailure "continue" is skipped and the run ends done`, async () => {
    const { events, result } = await drivenRun(
      [toolCall("lookup", { order: 1 }), text("Done.")],
      { ...interceptors, onFailure: "continue" },
      { tools: [lookup] },
    );
    assert.equal(result.stopReason, "done");
    assert.ok(events.some((event) => event.type === "hook_error" && event.hook === name));
  });
}

test("a hook that mutates its event fails closed, because the event's data is frozen", async () => {
  const { result } = await drivenRun([text("Done.")], {
    transformContext: async (e) => {
      (e.messages as unknown[]).push("extra");
      return e.messages;
    },
  });
  assert.equal(result.stopReason, "error");
  assert.match(result.stopReason === "error" ? result.error.message : "", /not extensible/);
});

test("a hook that mutates a message inside its event throws as well", async () => {
  let caught: unknown;
  await drivenRun([text("Done.")], {
    transformContext: async (e) => {
      try {
        (e.messages[0] as { content: unknown[] }).content.push("extra");
      } catch (error) {
        caught = error;
      }
      return e.messages;
    },
  });
  assert.ok(caught instanceof TypeError);
});

test("a hook that fails because the run was aborted ends the run aborted, not in error", async () => {
  const controller = new AbortController();
  const { result } = await drivenRun(
    [text("Done.")],
    {
      beforeModelCall: async () => {
        controller.abort();
        throw new Error("cancelled");
      },
    },
    { signal: controller.signal },
  );
  assert.equal(result.stopReason, "aborted");
});

test("a failed hook's run still ends with agent_settled before run_end", async () => {
  const { events } = await drivenRun([text("Done.")], { beforeModelCall: boom });
  assert.deepEqual(
    events.slice(-2).map((event) => event.type),
    ["agent_settled", "run_end"],
  );
});

test("a hook that returns the wrong shape rejects the run, whatever onFailure says", async () => {
  const { hookedRun } = await import("./hook-helpers.js");
  const { started } = hookedRun([text("Done.")], {
    onFailure: "continue",
    transformContext: (async () => "no") as never,
  });
  await assert.rejects(started.result, { code: "invalid_hook_result" });
});
