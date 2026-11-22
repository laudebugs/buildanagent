/**
 * `@buildanagent/harness/testing`: test doubles and conformance suites for the harness's components. The in-memory
 * sandbox, the session store and their conformance suites are here so far.
 */
export {
  FAKE_COMMANDS,
  type FakeSandboxClient,
  type FakeSandboxOptions,
  fakeSandbox,
  type RecordedExec,
} from "./fake-sandbox.js";
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
  runStoreConformance,
  type StoreCase,
  type StoreConformanceReport,
  type StoreFactory,
  type StoreUnderTest,
  storeConformanceCases,
} from "./store-conformance.js";
