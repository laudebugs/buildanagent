// A compile-time check that `ProtocolMessage` and the type zod infers from the protocol schema's source accept the same
// values, as schema-check/types.ts does for entries, under the same flag setting (see there). The one exception is the
// SDK event inside an `event` notification, which the schema mirrors loosely, so those notifications are compared apart,
// with the event left out and then with only the harness's own events.
import type { HarnessEvent, ProtocolMessage } from "@buildanagent/protocol";
import type { MirroredMessage } from "../scripts/protocol-schema.js";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type IsEvent<T> = T extends { method: "event" } ? T : never;
type NotEvent<T> = T extends { method: "event" } ? never : T;
type EventParams<T> = IsEvent<T> extends { params: infer P } ? P : never;

/** `true` while the two types accept the same values; the assignment fails to compile otherwise. */
export const SAME_MESSAGES: Same<NotEvent<ProtocolMessage>, NotEvent<MirroredMessage>> = true;
export const SAME_EVENT_ENVELOPE: Same<
  Omit<EventParams<ProtocolMessage>, "event">,
  Omit<EventParams<MirroredMessage>, "event">
> = true;
export const SAME_HARNESS_EVENTS: Same<
  Extract<EventParams<MirroredMessage>["event"], { type: HarnessEvent["type"] }>,
  HarnessEvent
> = true;
