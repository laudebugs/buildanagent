// Every example in examples/ runs offline on a scripted model and does what the README says it does.
import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { askOnce } from "../examples/run-json.js";
import { reply, scripted, stateDir } from "./cli-helpers.js";

let cleanup: () => void = () => undefined;
afterEach(() => cleanup());

test("run-json.ts exits 0 and returns the session line first and the settled line last", async () => {
  const state = stateDir();
  cleanup = state.cleanup;
  const { model, adapter } = scripted([reply("Three tests fail.")]);
  const { status, objects } = await askOnce(model, state.dir, "How many tests fail?");
  adapter.assertComplete();
  assert.equal(status, 0);
  assert.equal(objects[0]?.type, "session");
  assert.equal(objects.at(-1)?.type, "settled");
});
