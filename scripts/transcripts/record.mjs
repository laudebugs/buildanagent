// The transcript recorder that each harness's `scripts/run-examples.mjs` preloads into an example's process with
// `--import`, after tsx. It keeps the events the harness's mock layer reports, each with the line of the example file
// that led to it, and writes them as raw JSON to $TRANSCRIPT_FILE when the process exits. `write.mjs` then normalises
// them into `results/transcripts/<example>.json`. Without $TRANSCRIPT_FILE, as when an example runs on its own, the
// recorder is not installed and the mock layer's calls do nothing.
//
// The mock layer finds the recorder at globalThis[Symbol.for("buildanagent.transcript")]; recording only reads what
// the mock already holds, so it cannot change what an example does or whether its checks pass.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const out = process.env.TRANSCRIPT_FILE;
const example = process.argv[1] ? resolve(process.argv[1]) : undefined;

/** A copy of `value` that JSON can hold: no functions, cycles, bigints or binary data, and `undefined` dropped. */
function plain(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  try {
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) return { error: value.message };
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return `[${value.byteLength} bytes]`;
    if (value instanceof Map) return plain(Object.fromEntries(value), seen);
    if (value instanceof Set) return plain([...value], seen);
    if (Array.isArray(value)) return value.map((item) => plain(item, seen) ?? null);
    const copy = {};
    for (const [key, item] of Object.entries(value)) {
      const kept = plain(item, seen);
      if (kept !== undefined) copy[key] = kept;
    }
    return copy;
  } finally {
    seen.delete(value);
  }
}

/** The path in one stack frame, such as `at f (/a/b.ts:3:7)` or `at async file:///a/b.ts:3:7`, with its line. */
const FRAME = /(?:\(|at (?:async )?)((?:file:\/\/)?\/[^():]+|[A-Za-z]:\\[^():]+):(\d+):\d+\)?$/;

/** The line of the example file nearest the top of the current stack, or undefined when the example is not on it. */
function exampleLine() {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 200;
  const stack = new Error().stack ?? "";
  Error.stackTraceLimit = limit;
  for (const frame of stack.split("\n").slice(1)) {
    const match = FRAME.exec(frame.trim());
    if (!match) continue;
    const path = match[1].startsWith("file://") ? fileURLToPath(match[1]) : match[1];
    if (path === example) return Number(match[2]);
  }
  return undefined;
}

if (out) {
  const events = [];
  globalThis[Symbol.for("buildanagent.transcript")] = {
    record(event) {
      const line = exampleLine();
      const copy = plain(event);
      // The line follows the kind, so each event in the file reads as "what happened, and where".
      events.push(line === undefined ? copy : { kind: copy.kind, line, ...copy });
    },
  };
  process.on("exit", () => {
    writeFileSync(out, JSON.stringify({ events }));
  });
}
