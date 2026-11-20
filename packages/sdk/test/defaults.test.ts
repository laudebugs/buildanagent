import assert from "node:assert/strict";
import { DEFAULTS_HASH } from "@buildanagent/sdk";
import { test } from "vitest";
import { fillTemplate, hashedDefaults, SDK_DEFAULTS } from "../src/defaults.js";
import { canonicalInputHash } from "../src/vendor/agent-safety/hash.js";

// events.test.ts checks that run_start carries DEFAULTS_HASH; these tests tie the literal to the defaults module.

test("DEFAULTS_HASH is the hash of the defaults module, so a default can't change without changing it", async () => {
  const fresh = await canonicalInputHash(hashedDefaults());
  assert.equal(
    DEFAULTS_HASH,
    fresh,
    `A default, prompt or tool description changed. Set DEFAULTS_HASH in src/defaults.ts to "${fresh}" and add a ` +
      "changeset that releases @buildanagent/sdk and names the change; CI's changeset gate refuses an empty one.",
  );
});

test("changing any one default, prompt or outcome sentence changes the hash", async () => {
  const base = hashedDefaults() as { defaults: typeof SDK_DEFAULTS; outcomes: Record<string, unknown> };
  const variants = [
    { ...base, defaults: { ...base.defaults, run: { ...base.defaults.run, maxSteps: 21 } } },
    { ...base, defaults: { ...base.defaults, progress: { ...base.defaults.progress, maxSameKeyCalls: 6 } } },
    {
      ...base,
      defaults: {
        ...base.defaults,
        tools: { ...base.defaults.tools, output: { ...base.defaults.tools.output, description: "Submit it." } },
      },
    },
    { ...base, outcomes: { ...base.outcomes, effects: "changed" } },
  ];
  const hashes = await Promise.all(variants.map((variant) => canonicalInputHash(variant)));
  assert.equal(new Set([DEFAULTS_HASH, ...hashes]).size, variants.length + 1);
});

test("the defaults can't be changed at run time", () => {
  assert.ok(Object.isFrozen(SDK_DEFAULTS));
  assert.ok(Object.isFrozen(SDK_DEFAULTS.tools.output));
  assert.throws(() => {
    (SDK_DEFAULTS.run as { maxSteps: number }).maxSteps = 1;
  }, TypeError);
});

test("fillTemplate fills each slot once and leaves an unknown slot as written", () => {
  assert.equal(
    fillTemplate('Tool "{tool}" failed: {message}', { tool: "a", message: "{tool}" }),
    'Tool "a" failed: {tool}',
  );
  assert.equal(fillTemplate("{missing} stays", {}), "{missing} stays");
});
