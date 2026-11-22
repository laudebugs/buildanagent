// The server side of the stdio tests, run as a child process: a dispatcher over a scripted model, served on this
// process's stdin and stdout by `stdioTransport()`, with diagnostics on stderr. It never reaches a network: the offline
// setup blocks non-loopback fetch here too, and the model is scripted.
//
// Usage: stdio-server.ts <mode> [maxLineBytes]. `basic` replies once, `approval` asks for a refund first, `slow` is
// `basic` with a store whose list takes 300 ms, so a command is still running when the input ends, and `flood` streams
// one long reply in thousands of deltas and reports, on stderr, how much stdout held at most.
import "@buildanagent/gateway/testing/setup";
import process from "node:process";
import { inProcessTransport, stdioTransport } from "@buildanagent/harness/server";
import { memoryBackend } from "../session/memory-backend.js";
import { approvalSetup, callTool, reply, type Steps } from "./server-helpers.js";

/** The session the `flood` mode watches from inside the child; the test creates it under this id (stdio-child.ts). */
const FLOOD_SESSION = "flood";
/**
 * The `flood` reply: four text blocks of 25,000 characters, 25,000 deltas at four characters each. Each block is its
 * own entry, so none goes over the store's bound on one entry.
 */
const FLOOD_BLOCKS = Array.from({ length: 4 }, () => ({ type: "text" as const, text: "x".repeat(25_000) }));

const [mode = "basic", maxLineBytes] = process.argv.slice(2);
const stderr = (value: unknown) => process.stderr.write(`${JSON.stringify(value)}\n`);

// The environment's names, so the test can check that nothing from the parent arrived.
stderr({ env: Object.keys(process.env).sort() });

const steps: Steps =
  mode === "approval"
    ? [{ content: [callTool("c1", "refund", { id: "o1" })] }, reply("Refunded.")]
    : mode === "flood"
      ? [{ content: FLOOD_BLOCKS }]
      : [reply("Hello from the child.")];
const backend = memoryBackend();
const store =
  mode === "slow"
    ? {
        ...backend.store,
        async *list(userId: string) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          yield* backend.store.list(userId);
        },
      }
    : backend.store;
const { dispatcher } = approvalSetup(steps, [], {}, { ...backend, store });

/** In `flood` mode, watches the session from inside the child and reports stdout's largest backlog once it settles. */
async function reportFlood(): Promise<void> {
  let most = 0;
  const sample = setInterval(() => {
    most = Math.max(most, process.stdout.writableLength);
  }, 2);
  const watcher = inProcessTransport(dispatcher);
  watcher.onMessage((message) => {
    if (!("id" in message) && message.method === "turn/settled") {
      clearInterval(sample);
      most = Math.max(most, process.stdout.writableLength);
      stderr({ settled: message.params.result.stopReason, mostWaiting: most });
      watcher.close();
    }
  });
  await watcher.request("initialize", { clientInfo: { name: "watcher", version: "0" }, capabilities: [] });
  for (;;) {
    try {
      await watcher.request("session/open", { session: FLOOD_SESSION, cwd: "/work" });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}
if (mode === "flood") void reportFlood();

await stdioTransport(
  dispatcher,
  { input: process.stdin, output: process.stdout, log: (line) => process.stderr.write(`${line}\n`) },
  maxLineBytes === undefined ? {} : { maxLineBytes: Number(maxLineBytes) },
);
await dispatcher.close();
stderr({ done: true });
