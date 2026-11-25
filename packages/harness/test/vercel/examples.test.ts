// Runs the README's Vercel examples offline: the state seams on PGlite, and the wake workflow with the Workflow SDK's
// four functions replaced by stand-ins that run a started workflow at once and let every sleep end immediately.
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, test, vi } from "vitest";
import { vercelState } from "../../examples/vercel-state.js";
import { app, harnessScheduler } from "../../examples/vercel-wake.js";
import { TEST_RING } from "./ring.js";

vi.mock("workflow", () => ({
  sleep: async () => undefined,
  createHook: () => ({
    // biome-ignore lint/suspicious/noThenProperty: a Workflow hook is a thenable that resolves on a cancel.
    then: () => new Promise(() => undefined),
    getConflict: async () => null,
    dispose: () => undefined,
  }),
}));
vi.mock("workflow/api", () => ({
  start: async (workflow: (...args: unknown[]) => Promise<unknown>, args: unknown[]) => ({
    returnValue: await workflow(...args),
  }),
  resumeHook: async () => undefined,
}));

let db: PGlite;
beforeAll(() => {
  db = new PGlite();
});
afterAll(async () => {
  await db.close();
});

test("the state example creates the tables and returns seams that work", async () => {
  const state = await vercelState(db, { HARNESS_KEY_RING: TEST_RING });
  const key = { userId: "ada", sessionId: "s1" };
  const hold = await state.lock.acquire(key);
  assert.notEqual(hold, "would_block");
  assert.equal(await state.lock.acquire(key), "would_block");
  if (hold !== "would_block") await hold.release();
  assert.equal((await state.keyStore.load()).current, "2026-11");
  assert.deepEqual(await state.ledger.removeAll("nobody"), []);
});

test("the wake example records a wake, runs its workflow and delivers it once in its step", async () => {
  await vercelState(db, { HARNESS_KEY_RING: TEST_RING });
  const woken: string[] = [];
  app.connect = () => db;
  app.onWake = async (sessionId) => {
    woken.push(sessionId);
  };
  await harnessScheduler(db).wake(new Date(Date.parse("2026-11-24T00:00:00.000Z")), "s1");
  assert.deepEqual(woken, ["s1"]);
  const { rows } = await db.query("SELECT * FROM harness_wakes");
  assert.deepEqual(rows, [], "the delivered wake left the ledger");
});
