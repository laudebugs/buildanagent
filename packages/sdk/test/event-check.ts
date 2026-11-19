// The emitted-against-declared event check. Every run a test drives through `drive()` records its event types here,
// and test/setup.ts calls `assertDeclaredEvents()` after each test, so a test whose run emits a type that
// AGENT_EVENT_TYPES doesn't declare fails.
import { AGENT_EVENT_TYPES } from "@buildanagent/sdk";

const declared = new Set<string>(AGENT_EVENT_TYPES);
let emitted = new Set<string>();

/** Records the type of each event a test saw. */
export function recordEventTypes(events: Iterable<{ readonly type: string }>): void {
  for (const event of events) emitted.add(event.type);
}

/** Throws if any recorded type is undeclared, and clears the record for the next test. */
export function assertDeclaredEvents(): void {
  const undeclared = [...emitted].filter((type) => !declared.has(type));
  emitted = new Set();
  if (undeclared.length > 0) {
    throw new Error(`events of types missing from AGENT_EVENT_TYPES were emitted: ${undeclared.join(", ")}`);
  }
}
