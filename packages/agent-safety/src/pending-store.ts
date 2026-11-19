/**
 * `PendingStore`: where an agent keeps its signed pending requests between a pause and its resume, keyed by the tool
 * call's id. A record is taken, not read, when the call resumes, so one approval runs its call at most once.
 */
import type { SignedPendingRequest } from "./pending.js";

/**
 * Holds signed pending requests by call id. A store may live anywhere, even where others can write, because every
 * record is verified against its signature before it counts. On a serverless host, use storage that outlives the
 * isolate or function, such as Durable Object storage.
 */
export interface PendingStore {
  /** Stores `request` under its `callId`, replacing any earlier request for that call. */
  put(request: SignedPendingRequest): Promise<void>;
  /** Removes and returns the request for `callId`, or `undefined` if there is none. */
  take(callId: string): Promise<SignedPendingRequest | undefined>;
}

/**
 * A `PendingStore` in this process's memory, for tests and single-process hosts. It stores a copy of each request and
 * hands back a copy, so changing a request object outside the store never changes what the store holds.
 */
export function memoryPendingStore(): PendingStore {
  const requests = new Map<string, SignedPendingRequest>();
  return {
    async put(request) {
      requests.set(request.callId, structuredClone(request));
    },
    async take(callId) {
      const request = requests.get(callId);
      requests.delete(callId);
      return request;
    },
  };
}
