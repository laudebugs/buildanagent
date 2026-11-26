// Runs the permission-rules example: each call gets the decision the rules give it, and every decision is logged.
import assert from "node:assert/strict";
import type { RecordedEntry } from "@buildanagent/harness/permissions";
import { test } from "vitest";
import { decide, decideCalls, supportPipeline } from "../../examples/permission-rules.js";
import { recorder } from "../permissions/helpers.js";

test("a call that an allow rule names is allowed", async () => {
  const { read } = await decideCalls(supportPipeline("default"), recorder());
  assert.deepEqual([read.decision, read.rule], ["allow", "allow[0]"]);
});

test("a call that an ask rule names asks, with the rule's reason", async () => {
  const { page } = await decideCalls(supportPipeline("default"), recorder());
  assert.deepEqual([page.decision, page.rule, page.reason], ["ask", "ask[0]", "An on-call engineer will be paged."]);
});

test("a call that a deny rule names is denied, with the rule's reason", async () => {
  const { remove } = await decideCalls(supportPipeline("default"), recorder());
  assert.deepEqual(
    [remove.decision, remove.rule, remove.reason],
    ["deny", "deny[0]", "Deleting files is never allowed."],
  );
});

test("a call no rule names asks when a person can answer", async () => {
  const { other } = await decideCalls(supportPipeline("default"), recorder());
  assert.deepEqual([other.decision, other.rule], ["ask", "no_match"]);
});

test("a call no rule names is denied when nobody can answer", async () => {
  const { other } = await decideCalls(supportPipeline("default", false), recorder());
  assert.deepEqual(
    [other.decision, other.reason],
    ["deny", "No rule covers this call and nobody can be asked, so it is refused."],
  );
});

test("a deny rule beats bypass mode", async () => {
  const { remove, other } = await decideCalls(supportPipeline("bypass"), recorder());
  assert.equal(remove.decision, "deny");
  assert.equal(other.decision, "allow");
});

test("read-only mode denies a tool that is not read-only, whatever an ask rule says", async () => {
  const decision = await decide(supportPipeline("read_only"), recorder(), "escalate");
  assert.equal(decision.decision, "deny");
});

test("each decision writes one permission_decision entry, allows included", async () => {
  const session = recorder();
  await decideCalls(supportPipeline("default"), session);
  const entries: RecordedEntry[] = session.entries;
  assert.deepEqual(
    entries.map((entry) => entry.type),
    Array(4).fill("permission_decision"),
  );
});
