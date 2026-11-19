// Offline tests for the version choice in sdk-updates.mjs; run with `node --test scripts/ci/*.test.mjs`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { newestEligible } from "./sdk-updates.mjs";

const NOW = Date.parse("2026-11-19T00:00:00Z");
const times = {
  "1.0.0": "2026-10-01T00:00:00Z",
  "1.1.0": "2026-11-01T00:00:00Z",
  "1.2.0": "2026-11-18T00:00:00Z",
  "2.0.0-beta.1": "2026-11-02T00:00:00Z",
  "0.9.0-beta.2": "2026-11-03T00:00:00Z",
  "0.9.0-beta.1": "2026-10-03T00:00:00Z",
};
const versions = Object.keys(times);

test("picks the newest stable release at least seven days old", () => {
  assert.deepEqual(newestEligible("1.0.0", versions, times, NOW), { version: "1.1.0", published: times["1.1.0"] });
});

test("skips a release younger than seven days", () => {
  assert.equal(newestEligible("1.1.0", versions, times, NOW), undefined);
});

test("a stable pin never moves to a prerelease", () => {
  assert.equal(newestEligible("1.1.0", ["2.0.0-beta.1"], times, NOW), undefined);
});

test("a prerelease pin may move to a newer stable release or a prerelease of its own major", () => {
  assert.equal(newestEligible("0.9.0-beta.1", versions, times, NOW)?.version, "1.1.0");
  assert.equal(newestEligible("0.9.0-beta.1", ["0.9.0-beta.2"], times, NOW)?.version, "0.9.0-beta.2");
  assert.equal(newestEligible("0.9.0-beta.1", ["2.0.0-beta.1"], times, NOW), undefined);
});

test("an unparseable pin is left alone", () => {
  assert.equal(newestEligible("latest", versions, times, NOW), undefined);
});
