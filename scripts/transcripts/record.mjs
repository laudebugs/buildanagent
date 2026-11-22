// The transcript recorder that each harness's `scripts/run-examples.mjs` preloads into an example's process with
// `--import`, after tsx. It keeps the events the harness's mock layer reports (events.ts), each with the line of the
// example file that led to it, and writes them as raw JSON to $TRANSCRIPT_FILE when the process exits. `write.mjs`
// then normalises them into `results/transcripts/<example>.json`. Without $TRANSCRIPT_FILE, as when an example runs on
// its own, the recorder is not installed and the mock layer attaches nothing.
//
// The recorder also records each check() itself, so no listed helper carries recorder code: every harness's check()
// prints "ok - <message>" when it passes and throws "ASSERTION FAILED: <message>" when it fails. The recorder reads
// that line on its way to the console and that error on its way out of the process, and changes neither. It counts
// them only when the call stack shows they came from check() in the harness's examples/lib/, so an example cannot
// forge a check by printing the same text.
//
// The mock layer finds the recorder at globalThis[Symbol.for("buildanagent.transcript")]; recording only reads what
// the mock already holds, so it cannot change what an example does or whether its checks pass.
import { AsyncLocalStorage } from "node:async_hooks";
import { realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const out = process.env.TRANSCRIPT_FILE;
const example = process.argv[1] ? resolve(process.argv[1]) : undefined;
// A stack names a file by its real path, which differs from the argument when a directory on the way is a symbolic
// link, as macOS's temporary directory is.
const exampleReal = example === undefined ? undefined : realpathSync(example);

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

/** The line of the example file nearest the top of a stack, or undefined when the example is not on it. */
function lineIn(stack) {
  for (const frame of stack.split("\n").slice(1)) {
    const match = FRAME.exec(frame.trim());
    if (!match) continue;
    const path = match[1].startsWith("file://") ? fileURLToPath(match[1]) : match[1];
    if (path === example || path === exampleReal) return Number(match[2]);
  }
  return undefined;
}

/** The line of the example file nearest the top of the current stack. */
function exampleLine() {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 200;
  const stack = new Error().stack ?? "";
  Error.stackTraceLimit = limit;
  return lineIn(stack);
}

const CHECK_PASSED = "ok - ";
const CHECK_FAILED = "ASSERTION FAILED: ";
/** A stack frame in a harness's own `check()`, in `examples/lib/`: only that function's lines count as checks. */
const CHECK_FRAME = /^at check \((?:file:\/\/)?\/.*\/examples\/lib\/[^/]+\.ts:\d+:\d+\)$/;

/**
 * Whether the frame `depth` below the top of `stack` is a harness's `check()`. An example that prints "ok - …" or
 * throws "ASSERTION FAILED: …" itself is not that function, so it records no check.
 */
function fromCheck(stack, depth) {
  return CHECK_FRAME.test((stack.split("\n")[depth] ?? "").trim());
}

if (out) {
  const events = [];
  // The example line of the call that an SDK answers later, outside the example's stack (events.ts, recordCallers).
  const caller = new AsyncLocalStorage();
  const push = (event, line) => {
    const copy = plain(event);
    // The time lets a harness whose mock runs in another process merge its events with these in the order they
    // happened (write.mjs, mergeEvents); the writer drops it, so no transcript holds a clock reading. The same clock as
    // write.mjs's eventTime(), spelled out here so the recorder imports nothing.
    const at = performance.timeOrigin + performance.now();
    // The line follows the kind, so each event in the file reads as "what happened, and where".
    events.push(line === undefined ? { ...copy, at } : { kind: copy.kind, line, ...copy, at });
  };
  globalThis[Symbol.for("buildanagent.transcript")] = {
    record(event) {
      push(event, exampleLine() ?? caller.getStore());
    },
    atCaller(run) {
      return caller.run(exampleLine() ?? caller.getStore(), run);
    },
    enterCaller() {
      const line = exampleLine();
      if (line !== undefined) caller.enterWith(line);
    },
  };
  const log = console.log;
  console.log = function (...args) {
    // The stack's frames: the error line, this function, then whoever called console.log.
    const passed = args.length === 1 && typeof args[0] === "string" && args[0].startsWith(CHECK_PASSED);
    if (passed && fromCheck(new Error().stack ?? "", 2)) {
      push({ kind: "check", message: args[0].slice(CHECK_PASSED.length), pass: true }, exampleLine());
    }
    return log.apply(this, args);
  };
  process.on("uncaughtExceptionMonitor", (error) => {
    const message = error instanceof Error ? error.message : "";
    // The error's frames: its message, then the function that threw it.
    if (message.startsWith(CHECK_FAILED) && fromCheck(error.stack ?? "", 1)) {
      push({ kind: "check", message: message.slice(CHECK_FAILED.length), pass: false }, lineIn(error.stack ?? ""));
    }
  });
  process.on("exit", () => {
    writeFileSync(out, JSON.stringify({ events }));
  });
}
