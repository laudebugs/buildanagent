/**
 * The scheduler conformance suite: what every `Scheduler` must do. A wake arrives at or after its time, never before;
 * a duplicate wake is allowed but carries the right id and time; a cancel drops only the id it names. The cases import
 * no test runner and no Node module, so any runner can call them, in workerd too.
 */
import type { Scheduler } from "../session/scheduler.js";
import { type CaseReport, type RunnableCase, runCases } from "./run-cases.js";

/** One wake a scheduler delivered. */
export interface DeliveredWake {
  readonly sessionId: string;
  readonly at: Date;
}

/** What a factory returns: the scheduler, and the means to move its clock and read what it delivered. */
export interface SchedulerUnderTest {
  readonly scheduler: Scheduler;
  /** The scheduler's clock now. */
  readonly now: () => Date;
  /** Moves the clock to `to` and lets every wake that has come due by then be delivered before it resolves. */
  readonly advanceTo: (to: Date) => Promise<void>;
  /** Every wake delivered so far, in the order delivered. */
  readonly delivered: () => readonly DeliveredWake[];
}

/** Makes a fresh scheduler for each case. */
export type SchedulerFactory = () => SchedulerUnderTest | Promise<SchedulerUnderTest>;

export type SchedulerCase = RunnableCase;

export type SchedulerConformanceReport = CaseReport;

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Scheduler conformance: ${message}`);
}

const later = (from: Date, ms: number) => new Date(from.getTime() + ms);

/** The cases, each run against a scheduler from `factory`. */
export function schedulerConformanceCases(factory: SchedulerFactory): readonly SchedulerCase[] {
  const named = (name: string, body: (under: SchedulerUnderTest) => Promise<void>): SchedulerCase => ({
    name,
    run: async () => {
      await body(await factory());
      return undefined;
    },
  });
  return [
    named("a wake arrives at its time and not before", async ({ scheduler, now, advanceTo, delivered }) => {
      const at = later(now(), 10_000);
      await scheduler.wake(at, "s1");
      await advanceTo(later(now(), 9_999));
      check(delivered().length === 0, "a wake arrived before its time");
      await advanceTo(at);
      const [wake, ...rest] = delivered();
      check(wake !== undefined && rest.length === 0, "the wake did not arrive exactly once at its time");
      check(wake.sessionId === "s1" && wake.at.getTime() === at.getTime(), "the wake named another id or time");
    }),
    named("a wake that arrives late is still delivered", async ({ scheduler, now, advanceTo, delivered }) => {
      const at = later(now(), 1_000);
      await scheduler.wake(at, "s1");
      await advanceTo(later(now(), 60_000));
      check(delivered().length === 1, "a late wake was lost");
    }),
    named("a wake in the past is delivered at once", async ({ scheduler, now, advanceTo, delivered }) => {
      await scheduler.wake(later(now(), -5_000), "s1");
      await advanceTo(now());
      check(delivered().length === 1, "a past wake was not delivered");
    }),
    named("a duplicate wake is harmless", async ({ scheduler, now, advanceTo, delivered }) => {
      const at = later(now(), 1_000);
      await scheduler.wake(at, "s1");
      await scheduler.wake(at, "s1");
      await advanceTo(later(at, 1_000));
      const wakes = delivered();
      // At-least-once allows a second delivery, and the caller must be idempotent, but every delivery is a real wake.
      check(wakes.length >= 1, "no wake arrived");
      check(
        wakes.every((wake) => wake.sessionId === "s1" && wake.at.getTime() === at.getTime()),
        "a duplicate carried another id or time",
      );
    }),
    named("wakes for different sessions each arrive", async ({ scheduler, now, advanceTo, delivered }) => {
      await scheduler.wake(later(now(), 2_000), "b");
      await scheduler.wake(later(now(), 1_000), "a");
      await advanceTo(later(now(), 3_000));
      check(
        delivered()
          .map((wake) => wake.sessionId)
          .join() === "a,b",
        "the wakes did not arrive once each, in the order they came due",
      );
    }),
    named("a cancel drops a pending wake and only that session's", async ({ scheduler, now, advanceTo, delivered }) => {
      await scheduler.wake(later(now(), 1_000), "gone");
      await scheduler.wake(later(now(), 1_000), "kept");
      await scheduler.cancel("gone");
      await advanceTo(later(now(), 2_000));
      check(
        delivered().every((wake) => wake.sessionId === "kept") && delivered().length >= 1,
        "a cancelled wake arrived, or another session's was dropped",
      );
    }),
    named("a cancel of an id with no wake is fine", async ({ scheduler }) => {
      await scheduler.cancel("never-asked");
    }),
  ];
}

/** Runs every case and reports which passed, which skipped and which failed. */
export function runSchedulerConformance(factory: SchedulerFactory): Promise<SchedulerConformanceReport> {
  return runCases(schedulerConformanceCases(factory));
}
