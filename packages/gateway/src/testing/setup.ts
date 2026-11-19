/**
 * Shared test setup. Import it first in every test file under `packages/`:
 *
 *   import "@buildanagent/gateway/testing/setup";
 *
 * It installs the network guard, checks for provider keys and turns real model requests off.
 */
import { setModelRequestsAllowed } from "../request-policy.ts";
import { installTestGuards } from "./guards.ts";

installTestGuards();
setModelRequestsAllowed(false);
