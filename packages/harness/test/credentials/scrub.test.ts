import assert from "node:assert/strict";
import { REDACTED, scrubSecrets } from "@buildanagent/harness/credentials";
import type { SessionEntry } from "@buildanagent/protocol";
import { test } from "vitest";

const SECRET = "sk-live-9f8e7d6c5b4a39281706";

const entry = (rest: Record<string, unknown>): SessionEntry =>
  ({
    type: "tool_result",
    id: "e1",
    parentId: "e0",
    seq: 3,
    timestamp: "2026-11-22T08:00:00.000Z",
    origin: "tool",
    ...rest,
  }) as unknown as SessionEntry;

test("a secret is removed from every string, at any depth, and in keys", () => {
  const scrubbed = scrubSecrets(
    entry({
      content: [{ type: "text", text: `curl -H 'Authorization: Bearer ${SECRET}' https://api.test` }],
      details: { nested: { deeper: [`key=${SECRET}`, 7, null, true] }, [SECRET]: "as a key" },
    }),
    [SECRET],
  );
  const text = JSON.stringify(scrubbed);
  assert.ok(!text.includes(SECRET));
  assert.ok(text.includes(`Bearer ${REDACTED}`));
  assert.ok(text.includes(`key=${REDACTED}`));
  assert.deepEqual(
    (scrubbed as unknown as { details: { nested: { deeper: unknown[] } } }).details.nested.deeper.slice(1),
    [7, null, true],
  );
});

test("a copy of the secret is removed too: percent-encoded, JSON-escaped and in base64", () => {
  const odd = 'p@ss"w/rd+=value\\x';
  const forms = [
    odd,
    encodeURIComponent(odd),
    JSON.stringify(odd).slice(1, -1),
    Buffer.from(odd).toString("base64").replace(/=+$/, ""),
    Buffer.from(odd).toString("base64url"),
    Buffer.from(`user:${odd}`).toString("base64"),
  ];
  const scrubbed = JSON.stringify(
    scrubSecrets(entry({ content: forms.slice(0, 5).map((text) => `x ${text} y`) }), [odd]),
  );
  for (const form of forms.slice(0, 5)) assert.ok(!scrubbed.includes(form), `${form} was left`);
});

test("a secret inside a Basic authorization header is removed, whatever the prefix and suffix", () => {
  const cases = ["user:", "x-access-token:", "a:", "longer-user-name:"].flatMap((prefix) =>
    [
      Buffer.from(`${prefix}${SECRET}`).toString("base64"),
      Buffer.from(`${prefix}${SECRET}:and-more`).toString("base64"),
      Buffer.from(`${prefix}${SECRET}`).toString("base64url"),
    ].map((form) => ({ prefix, form })),
  );
  const scrubbed = JSON.stringify(
    scrubSecrets(entry({ content: cases.map(({ form }) => `Authorization: Basic ${form}`) }), [SECRET]),
  );
  for (const { prefix, form } of cases) {
    // The characters of the first base64 group that holds only secret bytes, and the 12 secret bytes after it.
    const start = Math.ceil(prefix.length / 3) * 4;
    assert.ok(!scrubbed.includes(form.slice(start, start + 16)), `a piece of ${form} was left`);
  }
});

test("the entry's own fields are kept, and the input is not changed", () => {
  const original = entry({ content: `has ${SECRET}` });
  const before = JSON.stringify(original);
  const scrubbed = scrubSecrets(original, [SECRET]);
  assert.equal(JSON.stringify(original), before);
  assert.notEqual(scrubbed, original);
  for (const field of ["type", "id", "parentId", "seq", "timestamp", "origin"] as const) {
    assert.equal(
      (scrubbed as unknown as Record<string, unknown>)[field],
      (original as unknown as Record<string, unknown>)[field],
    );
  }
});

test("a structural field is never rewritten, even when a secret matches it", () => {
  const scrubbed = scrubSecrets(entry({ content: "ok" }), ["tool_result", "e1", "tool"]);
  assert.equal((scrubbed as { type: string }).type, "tool_result");
  assert.equal((scrubbed as { id: string }).id, "e1");
  assert.equal((scrubbed as { origin: string }).origin, "tool");
});

test("a secret that contains another is removed whole, longest first", () => {
  const scrubbed = scrubSecrets(entry({ content: "abcdefgh-LONGER-abcdefgh" }), [
    "abcdefgh",
    "abcdefgh-LONGER-abcdefgh",
  ]);
  assert.equal((scrubbed as unknown as { content: string }).content, REDACTED);
});

test("an empty list or an empty secret changes nothing", () => {
  const original = entry({ content: "nothing to hide" });
  assert.deepEqual(scrubSecrets(original, []), original);
  assert.deepEqual(scrubSecrets(original, [""]), original);
  assert.notEqual(scrubSecrets(original, []), original, "it is a copy even when there is nothing to remove");
});

test("several secrets are all removed, and unrelated text stays", () => {
  const scrubbed = scrubSecrets(entry({ content: "a one-secret-111 and two-secret-222 end" }), [
    "one-secret-111",
    "two-secret-222",
  ]);
  assert.equal((scrubbed as unknown as { content: string }).content, `a ${REDACTED} and ${REDACTED} end`);
});
