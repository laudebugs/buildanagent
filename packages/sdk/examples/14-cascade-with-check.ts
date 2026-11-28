// A cascade on our SDK needs no new feature. A shouldStop hook checks the fast model's text answer and, when the check
// fails, returns { continue } with a re-ask. A beforeModelCall hook then sends that re-ask to the slow model, with the
// original task as its only message. The check decides what the cascade costs: a schema check accepts a wrong answer
// that is well formed, while a check with a rule catches it at the price of one more slow call. The book's
// fast-and-slow-calls chapter lists it.
//
// The scripted counts imitate TypeSafe's cookbook, where 72 of 74 wrong answers passed a schema check. They prove
// nothing about a real model, and this example measures none. The prices come from the gateway's catalog as of
// November 2026: Haiku 5.5 at $0.10 and $0.50 per million input and output tokens, Sonnet 5.5 at $2 and $10. A real
// model swap also loses the cached prefix, which these scripted calls leave out.
import type { Model } from "@buildanagent/gateway";
import { run } from "@buildanagent/sdk";
import { z } from "zod";
import { check, pricedScripted } from "./lib/check.js";
import { callPrice, FAST, fastStep, nanos, SLOW, slowStep, TASKS, type Task, textOf } from "./lib/schedule-tasks.js";

const OPEN = 9;
const CLOSE = 17;
const MAX_STEPS = 2;

// #region checks
const Slot = z.object({ start: z.number().int() });
const parse = (text: string) => {
  try {
    return Slot.safeParse(JSON.parse(text)).data;
  } catch {
    return undefined; // not JSON at all
  }
};
const schemaOnly = (_: { busy: number[] }, text: string) => parse(text) !== undefined;
const withRule = (task: { busy: number[] }, text: string) => {
  const slot = parse(text);
  return slot !== undefined && slot.start >= OPEN && slot.start < CLOSE && !task.busy.includes(slot.start);
};
// #endregion

/** Runs the task on the fast model; a failed check re-asks the slow one, once, with the original task alone. */
async function cascade(task: Task, passes: typeof withRule, fast: Model, slow: Model) {
  let escalated = false;
  // #region cascade
  const result = await run({
    model: fast,
    system: 'You book one-hour meetings. Reply as JSON: {"start": hour}.',
    input: `Busy hours today: ${task.busy.join(", ")}. Book the earliest free hour.`,
    maxSteps: MAX_STEPS, // book:note cap
    interceptors: {
      shouldStop: ({ lastMessage }) => {
        if (escalated || passes(task, textOf(lastMessage))) return false; // a slow answer ends the run, right or wrong
        escalated = true;
        return { continue: "That answer failed the check. Answer again." };
      },
      beforeModelCall: ({ context }) =>
        escalated ? { model: slow, messages: context.messages.slice(0, 1) } : undefined, // book:note escalate
    },
  }).result;
  // #endregion
  const last = result.messages.at(-1);
  return { text: last?.role === "assistant" ? textOf(last) : "", cost: result.cost.total ?? 0 };
}

async function ask(passes: typeof withRule, escalating: Task["fast"][], slowOnly = false) {
  const fast = slowOnly ? pricedScripted(TASKS.map(slowStep), SLOW) : pricedScripted(TASKS.map(fastStep), FAST);
  const slow = pricedScripted(TASKS.filter((t) => escalating.includes(t.fast)).map(slowStep), SLOW);
  let cost = 0;
  let correct = 0;
  for (const task of TASKS) {
    const answer = await cascade(task, passes, fast.model, slow.model);
    cost += answer.cost;
    correct += parse(answer.text)?.start === task.free ? 1 : 0;
  }
  fast.adapter.assertComplete();
  slow.adapter.assertComplete();
  const sentTaskOnly = slow.adapter.calls.every((call) => call.context.messages.length === 1);
  return { escalated: slow.adapter.calls.length, correct, cost: nanos(cost), sentTaskOnly };
}

check(
  nanos(callPrice(FAST)) === 300_000 && nanos(callPrice(SLOW)) === 6_000_000,
  "a fast call costs $0.0003, a slow $0.006",
);

const one = await ask(schemaOnly, ["invalid"]);
check(
  one.escalated === 2 && one.correct === 9 && one.cost === 15_000_000,
  "schema only: 2 escalate, 9 of 10 right, $0.015",
);
const two = await ask(withRule, ["invalid", "wrong"]);
check(
  two.escalated === 3 && two.correct === 10 && two.cost === 21_000_000,
  "schema and rule: 3 escalate, 10 of 10 right, $0.021",
);
check(one.sentTaskOnly && two.sentTaskOnly, "each slow call sent the original task alone");
const only = await ask(withRule, [], true);
check(only.correct === 10 && only.cost === 60_000_000, "slow only: 10 of 10 right, $0.06");
