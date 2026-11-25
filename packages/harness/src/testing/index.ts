/**
 * `@buildanagent/harness/testing`: test doubles and conformance suites for the harness's components. The in-memory
 * sandbox, and the conformance suites of the sandbox, the session store, the scheduler and the key store, are here so
 * far.
 *
 * @module @buildanagent/harness/testing
 */
export {
  FAKE_COMMANDS,
  type FakeSandboxClient,
  type FakeSandboxOptions,
  fakeSandbox,
  type RecordedExec,
} from "./fake-sandbox.js";
export {
  type KeyStoreCase,
  type KeyStoreConformanceReport,
  type KeyStoreFactory,
  type KeyStoreUnderTest,
  keyStoreConformanceCases,
  runKeyStoreConformance,
} from "./key-store-conformance.js";
export {
  runSandboxConformance,
  type SandboxCase,
  type SandboxConformanceOptions,
  type SandboxConformanceReport,
  type SandboxFactory,
  type SandboxUnderTest,
  sandboxConformanceCases,
} from "./sandbox-conformance.js";
export {
  type DeliveredWake,
  runSchedulerConformance,
  type SchedulerCase,
  type SchedulerConformanceReport,
  type SchedulerFactory,
  type SchedulerUnderTest,
  schedulerConformanceCases,
} from "./scheduler-conformance.js";
export {
  runStoreConformance,
  type StoreCase,
  type StoreConformanceReport,
  type StoreFactory,
  type StoreUnderTest,
  storeConformanceCases,
} from "./store-conformance.js";
