/**
 * Shared test setup. Import it first in every test file under `packages/`:
 *
 *   import "@buildanagent/gateway/testing/setup";
 *
 * It installs the network guard, checks for provider keys and turns real model requests off.
 *
 * @module @buildanagent/gateway/testing/setup
 */
import { setModelRequestsAllowed } from "../request-policy.js";
import { installTestGuards } from "./guards.js";

installTestGuards();
setModelRequestsAllowed(false);
