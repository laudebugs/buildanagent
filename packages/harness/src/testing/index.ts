/**
 * `@buildanagent/harness/testing`: test doubles and conformance suites for the harness's portable seams. Exports
 * `fakeSandbox()`, standalone suites for the seven harness seams, and the eight-seam portability suite
 * (`runPortabilityConformance()`).
 *
 * @module @buildanagent/harness/testing
 */
export {
  EGRESS_DENIED_TARGETS,
  type EgressCase,
  type EgressConformanceReport,
  type EgressDeniedTarget,
  type EgressFactory,
  type EgressProbeResult,
  type EgressUnderTest,
  egressConformanceCases,
  runEgressConformance,
} from "./egress-conformance.js";
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
  type LockCase,
  type LockConformanceReport,
  type LockFactory,
  type LockLeaseHarness,
  type LockUnderTest,
  lockConformanceCases,
  runLockConformance,
} from "./lock-conformance.js";
export {
  type EffectStoreFactory,
  PORTABILITY_SEAMS,
  type PortabilityCase,
  type PortabilityConformanceReport,
  type PortabilitySeam,
  type PortabilityTarget,
  portabilityConformanceCases,
  runPortabilityConformance,
} from "./portability-conformance.js";
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
export {
  runTransportConformance,
  type TransportCase,
  type TransportConformanceReport,
  type TransportFactory,
  type TransportUnderTest,
  transportConformanceCases,
} from "./transport-conformance.js";
