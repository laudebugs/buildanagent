import assert from "node:assert/strict";
import { createModel, type GatewayEvent, type ModelMiddleware } from "@buildanagent/gateway";
import { assertStreamContract } from "@buildanagent/gateway/testing";
import { test } from "vitest";
import { context, FailingAdapter, recordingSleep } from "./adapters.js";

function logging(name: string, log: string[]): ModelMiddleware {
  return {
    async transformParams(params) {
      log.push(`${name}.transformParams`);
      return { ...params, context: { ...params.context, system: `${params.context.system} ${name}` } };
    },
    async *wrapStream({ next }) {
      log.push(`${name}.wrapStream:before`);
      for await (const event of next()) {
        if (event.type === "done") log.push(`${name}.wrapStream:done`);
        yield event;
      }
      log.push(`${name}.wrapStream:after`);
    },
  };
}

test("the first middleware is outermost for both transformParams and wrapStream", async () => {
  const log: string[] = [];
  const adapter = new FailingAdapter([{ reply: "ok" }]);
  const model = createModel({ adapter, id: "m", middleware: [logging("a", log), logging("b", log)] });

  await assertStreamContract(model.stream(context));

  assert.deepEqual(log, [
    "a.transformParams",
    "b.transformParams",
    "a.wrapStream:before",
    "b.wrapStream:before",
    "b.wrapStream:done",
    "a.wrapStream:done",
    "b.wrapStream:after",
    "a.wrapStream:after",
  ]);
});

test("each transformParams sees the previous one's result, and the adapter gets the last", async () => {
  const seen: string[] = [];
  const adapter = new FailingAdapter([{ reply: "ok" }]);
  const spy: ModelMiddleware = {
    wrapStream: ({ next, context }) => {
      seen.push(context.system);
      return next();
    },
  };
  const model = createModel({ adapter, id: "m", middleware: [logging("a", []), logging("b", []), spy] });

  await model.complete(context);

  assert.deepEqual(seen, ["be brief a b"]);
});

test("middleware runs once per call, outside the retries, and sees the retry events", async () => {
  const log: string[] = [];
  const types: GatewayEvent["type"][] = [];
  const observer: ModelMiddleware = {
    async *wrapStream({ next }) {
      for await (const event of next()) {
        types.push(event.type);
        yield event;
      }
    },
  };
  const adapter = new FailingAdapter([{ fail: "retryable" }, { reply: "ok" }]);
  const model = createModel({
    adapter,
    id: "m",
    sleep: recordingSleep().sleep,
    middleware: [logging("a", log), observer],
  });

  await model.complete(context);

  assert.equal(adapter.calls.length, 2);
  assert.deepEqual(
    log.filter((entry) => entry === "a.transformParams"),
    ["a.transformParams"],
  );
  assert.deepEqual(types.slice(0, 3), ["start", "retry", "text_start"]);
});

test("a middleware can change the stream options the adapter receives", async () => {
  const adapter = new FailingAdapter([{ reply: "ok" }]);
  const capped: ModelMiddleware = {
    transformParams: (params) => ({ ...params, options: { ...params.options, maxOutputTokens: 64 } }),
  };

  await createModel({ adapter, id: "m", middleware: [capped] }).complete(context, { temperature: 0 });

  assert.equal(adapter.calls[0]?.maxOutputTokens, 64);
  assert.equal(adapter.calls[0]?.temperature, 0);
});
