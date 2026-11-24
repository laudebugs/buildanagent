/**
 * Portability conformance suite over all eight portable seams: `SessionStore`, `SessionLock`, `Scheduler`, `KeyStore`,
 * `SandboxClient`, `EgressPolicy`, the protocol transport and `EffectStore` (imported from
 * `@buildanagent/agent-safety/testing`). Any deployment target (local Node, Cloudflare, AWS or Vercel) supplies
 * factories for the seams it implements and runs one suite.
 */
import type { EffectStore } from "@buildanagent/agent-safety";
import { effectStoreConformance } from "@buildanagent/agent-safety/testing";
import { type EgressFactory, egressConformanceCases } from "./egress-conformance.js";
import { type KeyStoreFactory, keyStoreConformanceCases } from "./key-store-conformance.js";
import { type LockFactory, lockConformanceCases } from "./lock-conformance.js";
import { type CaseReport, type RunnableCase, runCases } from "./run-cases.js";
import { type SandboxConformanceOptions, type SandboxFactory, sandboxConformanceCases } from "./sandbox-conformance.js";
import { type SchedulerFactory, schedulerConformanceCases } from "./scheduler-conformance.js";
import { type StoreFactory, storeConformanceCases } from "./store-conformance.js";
import { type TransportFactory, transportConformanceCases } from "./transport-conformance.js";

/** The eight portable seams covered by `portabilityConformanceCases()`. */
export const PORTABILITY_SEAMS = [
  "store",
  "lock",
  "scheduler",
  "keyStore",
  "sandbox",
  "egress",
  "transport",
  "effectStore",
] as const;

/** Name of one of the eight portable seams. */
export type PortabilitySeam = (typeof PORTABILITY_SEAMS)[number];

/** Makes a fresh, empty `EffectStore` for each conformance case. */
export type EffectStoreFactory = () => EffectStore | Promise<EffectStore>;

/** Factories for the portable seams a deployment target implements. Omit a seam to skip it on a partial target. */
export interface PortabilityTarget {
  /** `SessionStore` seam. */
  readonly store?: StoreFactory;
  /** `SessionLock` seam. */
  readonly lock?: LockFactory;
  /** `Scheduler` seam. */
  readonly scheduler?: SchedulerFactory;
  /** `KeyStore` seam. */
  readonly keyStore?: KeyStoreFactory;
  /** `SandboxClient` seam, optionally paired with sandbox conformance options. */
  readonly sandbox?:
    | SandboxFactory
    | { readonly factory: SandboxFactory; readonly options?: SandboxConformanceOptions };
  /** `EgressPolicy` / egress enforcement seam. */
  readonly egress?: EgressFactory;
  /** Protocol transport seam. */
  readonly transport?: TransportFactory;
  /** `EffectStore` seam from `@buildanagent/agent-safety`. */
  readonly effectStore?: EffectStoreFactory;
}

/** One case of the unified portability conformance suite, prefixed with its seam name. */
export type PortabilityCase = RunnableCase;

/** The report returned by `runPortabilityConformance()`. */
export type PortabilityConformanceReport = CaseReport;

function prefix(seam: PortabilitySeam, cases: readonly RunnableCase[]): RunnableCase[] {
  return cases.map((item) => ({
    name: `${seam}: ${item.name}`,
    run: () => item.run(),
  }));
}

function effectStoreCases(factory: EffectStoreFactory): RunnableCase[] {
  return effectStoreConformance().map((item) => ({
    name: `effectStore: ${item.name}`,
    run: async () => {
      await item.run(factory);
      return undefined;
    },
  }));
}

/** Collects conformance cases for every seam supplied in `target`, each named `<seam>: <case>`. */
export function portabilityConformanceCases(target: PortabilityTarget): readonly PortabilityCase[] {
  const cases: RunnableCase[] = [];
  if (target.store !== undefined) cases.push(...prefix("store", storeConformanceCases(target.store)));
  if (target.lock !== undefined) cases.push(...prefix("lock", lockConformanceCases(target.lock)));
  if (target.scheduler !== undefined) cases.push(...prefix("scheduler", schedulerConformanceCases(target.scheduler)));
  if (target.keyStore !== undefined) cases.push(...prefix("keyStore", keyStoreConformanceCases(target.keyStore)));
  if (target.sandbox !== undefined) {
    const sandboxCases =
      typeof target.sandbox === "function"
        ? sandboxConformanceCases(target.sandbox)
        : sandboxConformanceCases(target.sandbox.factory, target.sandbox.options);
    cases.push(...prefix("sandbox", sandboxCases));
  }
  if (target.egress !== undefined) cases.push(...prefix("egress", egressConformanceCases(target.egress)));
  if (target.transport !== undefined) cases.push(...prefix("transport", transportConformanceCases(target.transport)));
  if (target.effectStore !== undefined) cases.push(...effectStoreCases(target.effectStore));
  return cases;
}

/** Runs every conformance case for `target` and returns which passed, skipped and failed. */
export function runPortabilityConformance(target: PortabilityTarget): Promise<PortabilityConformanceReport> {
  return runCases(portabilityConformanceCases(target));
}
