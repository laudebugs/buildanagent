import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_RETRY,
  isSafetyError,
  OUTCOME_KINDS,
  renderOutcome,
  type WriteOutcomeInit,
  writeOutcome,
} from "@buildanagent/agent-safety";
import { test } from "vitest";
import { SAMPLES } from "./outcome-fixtures.js";

const RENDERED = JSON.parse(readFileSync(new URL("./fixtures/rendered-outcomes.json", import.meta.url), "utf8"));

const MUST_NOT = {
  applied: "Do not run it again",
  not_applied: "Do not say that it happened",
  compensated: "Do not say that it took effect",
  partial: "Do not present it as a success",
  unknown: "do not retry it as a new request",
} as const;

function rejectsInvalidOutcome(init: unknown, pattern: RegExp): void {
  assert.throws(
    () => writeOutcome(init as WriteOutcomeInit),
    (error) => isSafetyError(error) && error.code === "invalid_outcome" && pattern.test(error.message),
  );
}

test("the samples cover each of the five kinds once", () => {
  assert.deepEqual(
    SAMPLES.map((outcome) => outcome.kind),
    OUTCOME_KINDS,
  );
});

for (const outcome of SAMPLES) {
  test(`a ${outcome.kind} outcome renders the recorded sentences`, () => {
    assert.equal(renderOutcome(outcome).text, RENDERED[outcome.kind]);
  });

  test(`a ${outcome.kind} outcome's sentences name the operation and what not to do`, () => {
    const { text } = renderOutcome(outcome);
    assert.match(text, /refund_create/);
    assert.ok(text.includes(MUST_NOT[outcome.kind]), text);
  });
}

test("every kind except applied sets the error flag", () => {
  assert.deepEqual(
    SAMPLES.map((outcome) => [outcome.kind, renderOutcome(outcome).isError]),
    [
      ["applied", false],
      ["not_applied", true],
      ["compensated", true],
      ["partial", true],
      ["unknown", true],
    ],
  );
});

test("the payload carries the outcome's fields and leaves out the ones it omits", () => {
  const unknown = SAMPLES[4];
  assert.ok(unknown);
  assert.deepEqual(renderOutcome(unknown).payload, {
    kind: "unknown",
    operation: "refund_create",
    effectKey: "refund:order-4417",
    applied: [],
    reverted: [],
    notReversible: [],
    retry: "reconcile_first",
    next: "Look up order 4417's refunds before you do anything else",
    reason: "PROVIDER_TIMEOUT",
  });
});

test("each kind takes the default retry rule when the tool sets none", () => {
  for (const kind of OUTCOME_KINDS) {
    const outcome = writeOutcome({ kind, operation: "send_email", next: "Tell the user" } as WriteOutcomeInit);
    assert.equal(outcome.retry, DEFAULT_RETRY[kind]);
  }
});

test("the default retry rules follow the outcome table", () => {
  assert.deepEqual(DEFAULT_RETRY, {
    applied: "never",
    not_applied: "same_key",
    compensated: "new_operation_only",
    partial: "never",
    unknown: "reconcile_first",
  });
});

test("a tool may choose another retry rule that its kind allows", () => {
  const outcome = writeOutcome({ kind: "not_applied", operation: "send_email", next: "Stop", retry: "never" });
  assert.equal(outcome.retry, "never");
});

test("a retry rule the kind does not allow is rejected at construction", () => {
  rejectsInvalidOutcome(
    { kind: "unknown", operation: "send_email", next: "Check", retry: "new_operation_only" },
    /unknown/,
  );
});

test("an unknown kind is rejected at construction", () => {
  rejectsInvalidOutcome({ kind: "rolled_back", operation: "send_email", next: "Check" }, /rolled_back/);
});

test("an empty next is rejected at construction", () => {
  rejectsInvalidOutcome({ kind: "applied", operation: "send_email", next: "  " }, /next/);
});

test("a reason of 63 upper snake case characters is accepted", () => {
  const reason = `A${"_B".repeat(31)}`;
  assert.equal(reason.length, 63);
  assert.equal(writeOutcome({ kind: "not_applied", operation: "send_email", next: "Stop", reason }).reason, reason);
});

test("a reason longer than 63 characters is rejected at construction", () => {
  rejectsInvalidOutcome({ kind: "not_applied", operation: "send_email", next: "Stop", reason: "A".repeat(64) }, /63/);
});

for (const reason of ["card_declined", "Card_Declined", "_CARD", "CARD_", "1CARD", "CARD DECLINED", "AB"]) {
  test(`a reason of ${JSON.stringify(reason)} is rejected at construction as not upper snake case`, () => {
    rejectsInvalidOutcome({ kind: "not_applied", operation: "send_email", next: "Stop", reason }, /upper snake case/);
  });
}

test("a built outcome and its effect lists are frozen", () => {
  const outcome = writeOutcome({ kind: "applied", operation: "send_email", next: "Done", applied: ["email sent"] });
  assert.ok(Object.isFrozen(outcome));
  assert.ok(Object.isFrozen(outcome.applied));
});

test("a built outcome copies the effect lists it is given", () => {
  const applied = ["email sent"];
  const outcome = writeOutcome({ kind: "applied", operation: "send_email", next: "Done", applied });
  applied.push("second email sent");
  assert.deepEqual(outcome.applied, ["email sent"]);
});

test("the README's declined refund renders the text the README shows", () => {
  const outcome = writeOutcome({
    kind: "not_applied",
    operation: "refund_create",
    reason: "CARD_DECLINED",
    next: "Ask the requester for another payment method",
  });
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.ok(readme.includes(`> ${renderOutcome(outcome).text}\n`), renderOutcome(outcome).text);
});

test("an operation name with a replacement pattern renders as written", () => {
  const outcome = writeOutcome({ kind: "unknown", operation: "pay$&x$'", next: "Check" });
  assert.ok(renderOutcome(outcome).text.startsWith("It is not known whether the pay$&x$' call took effect."));
});

for (const field of ["currentState", "avoid", "effectKey"] as const) {
  test(`a blank ${field} is rejected at construction`, () => {
    rejectsInvalidOutcome({ kind: "not_applied", operation: "send_email", next: "Stop", [field]: " " }, /non-empty/);
  });
}

for (const [kind, field] of [
  ["not_applied", "applied"],
  ["not_applied", "reverted"],
  ["not_applied", "notReversible"],
  ["applied", "reverted"],
  ["compensated", "applied"],
] as const) {
  test(`a ${kind} outcome that lists ${field} effects is rejected at construction`, () => {
    rejectsInvalidOutcome({ kind, operation: "send_email", next: "Stop", [field]: ["email sent"] }, new RegExp(field));
  });
}

for (const kind of ["partial", "unknown"] as const) {
  test(`a ${kind} outcome needs an effectKey to allow a same_key retry`, () => {
    rejectsInvalidOutcome({ kind, operation: "refund_create", next: "Check", retry: "same_key" }, /effectKey/);
    const keyed = writeOutcome({ kind, operation: "refund_create", next: "Check", retry: "same_key", effectKey: "k" });
    assert.match(renderOutcome(keyed).text, /takes effect at most once/);
  });
}

test("a not_applied outcome without an effectKey doesn't promise a keyed retry", () => {
  const outcome = writeOutcome({ kind: "not_applied", operation: "send_email", next: "Stop" });
  const { text } = renderOutcome(outcome);
  assert.doesNotMatch(text, /at most once/);
  assert.match(text, /this attempt changed nothing/);
});

test("an effect that ends in a full stop renders with one", () => {
  const outcome = writeOutcome({ kind: "applied", operation: "send_email", next: "Done", applied: ["email sent."] });
  assert.match(renderOutcome(outcome).text, /Still in effect: email sent\. Next:/);
});
