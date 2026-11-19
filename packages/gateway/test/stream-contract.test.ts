import assert from "node:assert/strict";
import {
  assertStreamContract,
  type GatewayEvent,
  isGatewayError,
  type ModelEvent,
  StreamContractError,
} from "@buildanagent/gateway";
import { test } from "vitest";
import { message, streamOf, validEvents } from "./fixtures.js";

const rejects = (events: ModelEvent[], pattern: RegExp) =>
  assert.rejects(
    () => assertStreamContract(streamOf(events)),
    (error: unknown) => error instanceof StreamContractError && pattern.test(error.message),
  );

test("a valid stream passes and every event is returned", async () => {
  const events = validEvents();
  assert.deepEqual(await assertStreamContract(streamOf(events)), events);
});

test("an error terminal with partial content passes", async () => {
  await assertStreamContract(
    streamOf([
      { type: "start" },
      { type: "text_start", index: 0 },
      { type: "text_delta", index: 0, delta: "Hal" },
      { type: "error", message: message("aborted", [{ type: "text", text: "Hal" }]) },
    ]),
  );
});

test("rejects a delta before its start", () =>
  rejects(
    [{ type: "start" }, { type: "text_delta", index: 0, delta: "x" }, { type: "done", message: message("stop") }],
    /before index 0 started/,
  ));

test("rejects a delta after its end", () =>
  rejects(
    [
      { type: "start" },
      { type: "text_start", index: 0 },
      { type: "text_end", index: 0, block: { type: "text", text: "" } },
      { type: "text_delta", index: 0, delta: "x" },
      { type: "done", message: message("stop") },
    ],
    /after index 0 ended/,
  ));

test("rejects two terminals", () =>
  rejects(
    [{ type: "start" }, { type: "done", message: message("stop") }, { type: "done", message: message("stop") }],
    /followed the terminal/,
  ));

test("rejects a stream with no terminal", () =>
  rejects([{ type: "start" }, { type: "text_start", index: 0 }], /ended without a done or error/));

test("rejects an error terminal with stopReason stop", () =>
  rejects(
    [{ type: "start" }, { type: "error", message: message("stop") }],
    /needs stopReason error or aborted, got stop/,
  ));

test("rejects a done terminal with stopReason error", () =>
  rejects(
    [{ type: "start" }, { type: "done", message: message("error") }],
    /done terminal cannot have stopReason error/,
  ));

test("rejects a stream that does not begin with start", () =>
  rejects([{ type: "done", message: message("stop") }], /must begin with start/));

test("rejects a second start", () =>
  rejects([{ type: "start" }, { type: "start" }, { type: "done", message: message("stop") }], /start appeared twice/));

test("rejects mixed kinds on one index", () =>
  rejects(
    [
      { type: "start" },
      { type: "text_start", index: 0 },
      { type: "reasoning_delta", index: 0, delta: "x" },
      { type: "done", message: message("stop") },
    ],
    /started as text but got reasoning_delta/,
  ));

test("rejects a reused index", () =>
  rejects(
    [
      { type: "start" },
      { type: "text_start", index: 0 },
      { type: "text_end", index: 0, block: { type: "text", text: "" } },
      { type: "text_start", index: 0 },
      { type: "done", message: message("stop") },
    ],
    /index 0 started twice/,
  ));

test("rejects done with an open block", () =>
  rejects(
    [{ type: "start" }, { type: "text_start", index: 0 }, { type: "done", message: message("stop") }],
    /open blocks at index 0/,
  ));

test("reports the position of the offending event", async () => {
  await assert.rejects(
    () =>
      assertStreamContract(
        streamOf([{ type: "start" }, { type: "done", message: message("stop") }, { type: "start" }]),
      ),
    (error: unknown) => error instanceof StreamContractError && error.position === 2,
  );
});

test("StreamContractError is a GatewayError with code stream_contract", async () => {
  await assert.rejects(
    () => assertStreamContract(streamOf([{ type: "done", message: message("stop") }])),
    (error: unknown) => isGatewayError(error) && error.code === "stream_contract",
  );
});

const retry: GatewayEvent = { type: "retry", attempt: 1, delayMs: 2000, error: "overloaded" };

test("a retry event between start and the first block passes", async () => {
  const [start, ...rest] = validEvents();
  const events: GatewayEvent[] = [start as GatewayEvent, retry, ...rest];
  assert.deepEqual(await assertStreamContract(streamOf(events)), events);
});

test("rejects a retry event before start", () =>
  assert.rejects(
    () => assertStreamContract(streamOf<GatewayEvent>([retry, ...validEvents()])),
    /must begin with start/,
  ));

test("rejects a retry event after output", () =>
  assert.rejects(
    () =>
      assertStreamContract(
        streamOf<GatewayEvent>([
          { type: "start" },
          { type: "text_start", index: 0 },
          retry,
          { type: "error", message: message("error") },
        ]),
      ),
    /retry arrived after output/,
  ));

test("a warning between start and the terminal passes", async () => {
  await assertStreamContract(
    streamOf<ModelEvent>([
      { type: "start" },
      { type: "warning", code: "unsupported_option", message: "dropped temperature" },
      { type: "done", message: message("stop") },
    ]),
  );
});

test("rejects a warning before start", () =>
  rejects(
    [
      { type: "warning", code: "unsupported_option", message: "x" },
      { type: "done", message: message("stop") },
    ],
    /must begin with start/,
  ));

test("a retry after a warning passes, because a warning is not output", async () => {
  await assertStreamContract(
    streamOf<GatewayEvent>([
      { type: "start" },
      { type: "warning", code: "unsupported_option", message: "x" },
      { type: "retry", attempt: 1, delayMs: 0, error: "overloaded" },
      { type: "done", message: message("stop") },
    ]),
  );
});
