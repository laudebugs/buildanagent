import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { canonicalInputHash, isSafetyError } from "@buildanagent/agent-safety";
import { test } from "vitest";

function cyclic(): Record<string, unknown> {
  const value: Record<string, unknown> = { a: 1 };
  value.self = { back: value };
  return value;
}

function cyclicArray(): unknown[] {
  const value: unknown[] = [1];
  value.push(value);
  return value;
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

test("objects whose keys differ only in order hash the same", async () => {
  const a = { to: "ada@example.com", body: { text: "Hi", lang: "en" }, cc: ["b", "a"] };
  const b = { cc: ["b", "a"], body: { lang: "en", text: "Hi" }, to: "ada@example.com" };
  assert.equal(await canonicalInputHash(a), await canonicalInputHash(b));
});

test("a changed nested value gives a different hash", async () => {
  const base = await canonicalInputHash({ order: 4417, refund: { amount: 20, currency: "USD" } });
  const changed = await canonicalInputHash({ order: 4417, refund: { amount: 21, currency: "USD" } });
  assert.notEqual(base, changed);
});

test("a changed value type gives a different hash", async () => {
  assert.notEqual(await canonicalInputHash({ order: 4417 }), await canonicalInputHash({ order: "4417" }));
});

test("a reordered array gives a different hash", async () => {
  assert.notEqual(await canonicalInputHash(["a", "b"]), await canonicalInputHash(["b", "a"]));
});

test("the hash is the SHA-256 of the input's canonical JSON, in lowercase hex", async () => {
  assert.equal(await canonicalInputHash({ b: 1, a: [true, null] }), sha256('{"a":[true,null],"b":1}'));
});

test("the canonical form matches RFC 8785's sample", async () => {
  // RFC 8785 §3.2.2's input, already parsed: its first number, 333333333.33333329, parses to the double written here.
  const input = {
    numbers: [333333333.3333333, 1e30, 4.5, 2e-3, 1e-27],
    // Euro sign, $, U+000F, line feed, A, ', B, ", two backslashes, ", /.
    string: `${String.fromCharCode(0x20ac)}$${String.fromCharCode(0x0f)}\nA'B"\\\\"/`,
    literals: [null, true, false],
  };
  // The string as RFC 8785 serializes it: U+000F becomes a lowercase \u000f escape and the rest is JSON.stringify's.
  const string = `"${String.fromCharCode(0x20ac)}$\\u000f\\nA'B\\"\\\\\\\\\\"/"`;
  const expected = `{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":${string}}`;
  assert.equal(await canonicalInputHash(input), sha256(expected));
});

test("property names sort by UTF-16 code units", async () => {
  // U+1F600 is stored as the surrogate pair D83D DE00, which sorts before U+FB33 although its code point is larger.
  const high = String.fromCodePoint(0xfb33);
  const emoji = String.fromCodePoint(0x1f600);
  const input = { [high]: 1, [emoji]: 2, a: 3 };
  assert.equal(await canonicalInputHash(input), sha256(`{"a":3,"${emoji}":2,"${high}":1}`));
});

test("a property set to undefined hashes as if it were absent", async () => {
  assert.equal(await canonicalInputHash({ a: 1, b: undefined }), await canonicalInputHash({ a: 1 }));
});

test("negative zero hashes as zero", async () => {
  assert.equal(await canonicalInputHash(-0), await canonicalInputHash(0));
});

for (const [label, input] of [
  ["NaN", { n: Number.NaN }],
  ["Infinity", [Number.POSITIVE_INFINITY]],
  ["undefined in an array", [1, undefined]],
  ["a lone surrogate", { s: String.fromCharCode(0xd800) }],
  ["a bigint", { n: 1n }],
  ["a Date", { at: new Date(0) }],
  ["a function", { f: () => 1 }],
  ["undefined at the top", undefined],
  // biome-ignore lint/suspicious/noSparseArray: the hole is the case under test.
  ["a hole in a sparse array", [1, , 3]],
  ["an object that contains itself", cyclic()],
  ["an array that contains itself", cyclicArray()],
] as const) {
  test(`an input holding ${label} is rejected`, async () => {
    await assert.rejects(canonicalInputHash(input), (error) => isSafetyError(error) && error.code === "invalid_input");
  });
}

test("a value shared by two properties is no cycle", async () => {
  const shared = { n: 1 };
  assert.equal(await canonicalInputHash({ a: shared, b: [shared] }), sha256('{"a":{"n":1},"b":[{"n":1}]}'));
});

test("a plain object from another realm hashes like one from this realm", async () => {
  assert.equal(
    await canonicalInputHash(runInNewContext("({ b: [1], a: 2 })")),
    await canonicalInputHash({ a: 2, b: [1] }),
  );
});

test("a class instance is rejected as not plain", async () => {
  class Point {
    x = 1;
  }
  await assert.rejects(
    canonicalInputHash(new Point()),
    (error) => isSafetyError(error) && error.code === "invalid_input",
  );
});

test("each property is read once", async () => {
  let reads = 0;
  const input = {
    get flaky() {
      reads += 1;
      return reads === 1 ? 1 : undefined;
    },
  };
  assert.equal(await canonicalInputHash(input), sha256('{"flaky":1}'));
  assert.equal(reads, 1);
});

test("a lone surrogate in a property name is reported at that name", async () => {
  await assert.rejects(
    canonicalInputHash({ a: { [String.fromCharCode(0xd800)]: 1 } }),
    (error) => isSafetyError(error) && error.message.includes("$.a's property name holds a lone surrogate"),
  );
});
