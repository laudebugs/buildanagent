// Runs the triage example's pause: the first process stops at the escalation, and a second process answers it.
// Each case in the capstone fixture runs both processes on a scripted model, against files in a temporary folder.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, test } from "vitest";
import { CASES, type CaseName, entriesOf, filesAt, REASON, recordCase } from "../capstone/triage-fixture.js";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function run(name: CaseName) {
  const dir = mkdtempSync(join(tmpdir(), "triage-example-"));
  dirs.push(dir);
  const files = filesAt(dir);
  return { files, recorded: await recordCase(files, CASES[name]) };
}

test("the turn stops at the escalation and pages nobody", async () => {
  const { recorded } = await run("approved");
  assert.equal(recorded.paused.stopReason, "awaiting_approval");
  assert.deepEqual(recorded.first.escalations, []);
});

test("the pause is an approval_requested entry in the log", async () => {
  const { files, recorded } = await run("approved");
  const request = (await entriesOf(files)).find((entry) => entry.type === "approval_requested");
  assert.equal(request?.type === "approval_requested" && request.request.id, recorded.requestId);
});

test("a second process that answers allow pages the on-call engineer once", async () => {
  const { recorded } = await run("approved");
  assert.deepEqual(recorded.second.escalations, [REASON]);
  assert.equal(recorded.result.stopReason, "done");
});

test("a second process that answers deny pages nobody", async () => {
  const { recorded } = await run("rejected");
  assert.deepEqual(recorded.second.escalations, []);
});

test("a deny rule added after the pause beats the approval", async () => {
  const { recorded } = await run("policy_changed");
  assert.deepEqual(recorded.second.escalations, []);
});
