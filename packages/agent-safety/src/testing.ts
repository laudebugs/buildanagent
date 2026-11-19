/**
 * `@buildanagent/agent-safety/testing`: the fixed-key test signer. It has its own subpath, apart from the real
 * signers, so code that imports the root entry can't reach a key anyone can forge.
 */
import { type ApprovalSigner, hmacSigner } from "./signer.js";

/** The key id of `testSigner()`. */
export const TEST_KEY_ID = "test-fixed-key";
// Public on purpose: tests in any process, and fixtures checked into the repo, must produce the same signatures.
const TEST_KEY = new TextEncoder().encode("buildanagent testSigner fixed key, never for production");

/**
 * A signer with a fixed, published key, for tests and fixtures: every process produces the same signatures, so a
 * signed pause can be checked into a test. Anyone can forge its signatures. Never use it outside tests, and never add
 * its key id, `test-fixed-key`, to a real key ring.
 */
export function testSigner(): ApprovalSigner {
  return hmacSigner({ keys: { [TEST_KEY_ID]: TEST_KEY }, current: TEST_KEY_ID });
}
