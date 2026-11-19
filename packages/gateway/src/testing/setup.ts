/**
 * Shared test setup. Import it first in every test file under `packages/`:
 *
 *   import "@agent-speak/gateway/testing/setup";
 *
 * Later todos extend it (B4 adds `allowModelRequests(false)`).
 */
import { installTestGuards } from "./guards.ts";

installTestGuards();
