// The unified portability suite against the AWS adapters, each on an in-process fake of its service (N45, N47a).
import assert from "node:assert/strict";
import {
  PORTABILITY_SEAMS,
  portabilityConformanceCases,
  runPortabilityConformance,
} from "@buildanagent/harness/testing";
import { describe, test } from "vitest";
import { AWS_TARGET } from "./aws-target.js";

describe("the portability suite on the AWS target", () => {
  test("covers the store, lock, scheduler, key store and effect store seams", () => {
    const seams = new Set(portabilityConformanceCases(AWS_TARGET).map((c) => c.name.split(": ")[0]));
    assert.deepEqual(
      PORTABILITY_SEAMS.filter((seam) => seams.has(seam)),
      ["store", "lock", "scheduler", "keyStore", "effectStore"],
    );
  });

  test("every AWS adapter passes, skipping only what a table row and a read-only secret don't have", async () => {
    const report = await runPortabilityConformance(AWS_TARGET);
    assert.deepEqual(report.failed, []);
    assert.deepEqual(
      report.skipped.map((entry) => entry.name),
      [
        "store: a torn last line is skipped by load and reported once, with every complete entry kept",
        "store: an append after a torn line cuts it off, so the next entry is not glued to it",
        "keyStore: rotate adds a new current key and keeps the old one",
        "keyStore: prune keeps the current key and every key in use, and returns the ids it removed",
      ],
    );
    assert.ok(report.passed.length >= 30, `expected at least 30 passing cases, got ${report.passed.length}`);
  });
});
