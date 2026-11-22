// The offline setup for every test file: non-loopback fetch throws and a set provider key fails the run
// (docs/guidelines/testing.md). It is imported here, not named in setupFiles, so Vite resolves it through `source`.
import "@buildanagent/gateway/testing/setup";
