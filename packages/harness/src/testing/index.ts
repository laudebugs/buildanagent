/**
 * `@buildanagent/harness/testing`: test doubles and conformance suites for the harness's components. The in-memory
 * sandbox and the sandbox conformance suite are here so far.
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
