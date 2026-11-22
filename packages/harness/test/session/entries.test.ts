// `@buildanagent/harness/session` re-exports the protocol's entry union, so the two entries name the same values.
import assert from "node:assert/strict";
import * as session from "@buildanagent/harness/session";
import * as protocol from "@buildanagent/protocol";
import { test } from "vitest";

test("the session entry re-exports the protocol's runtime names, not copies of them", () => {
  assert.strictEqual(session.FORMAT_VERSION, protocol.FORMAT_VERSION);
  assert.strictEqual(session.isProtocolError, protocol.isProtocolError);
  assert.strictEqual(session.ProtocolError, protocol.ProtocolError);
  assert.strictEqual(session.parseEntry, protocol.parseEntry);
  assert.strictEqual(session.SESSION_ENTRY_TYPES, protocol.SESSION_ENTRY_TYPES);
});

test("an entry parsed through the harness entry is the protocol's entry", () => {
  const line = JSON.stringify({
    id: "e1",
    parentId: null,
    seq: 0,
    timestamp: "2026-11-22T03:00:00.000Z",
    origin: "harness",
    type: "checkout",
    headId: "e1",
  });
  const entry: session.SessionEntry = session.parseEntry(line);
  assert.equal(entry.type, "checkout");
  assert.throws(
    () => session.parseEntry({ ...entry, type: "session_header", formatVersion: 2 }),
    session.ProtocolError,
  );
});
