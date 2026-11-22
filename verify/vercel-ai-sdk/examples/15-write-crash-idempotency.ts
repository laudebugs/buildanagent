// A write tool that can fail halfway: it persists an idempotency key before it calls the server, reports an outcome,
// and after a crash between the server's write and the result it finds the key, reports `unknown`, asks the server
// instead of writing again, and the server sees one write. The effect log is a small file in a temp folder that the
// example makes and removes, the only file the tool writes; a package replaces it. It survives a killed process, not a
// power cut: nothing is synced to disk before the call.
// Docs: ai-sdk-core/tools-and-tool-calling.mdx
import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateText, isStepCount, tool } from "ai";
import { z } from "zod";
import { check, scripted } from "./lib/check.ts";

const CHILD_TIMEOUT_MS = 20_000;

/** What a write can have done: it took effect, it didn't, it was undone, part of it took effect, or nobody can tell. */
type Outcome = "applied" | "not_applied" | "compensated" | "partial" | "unknown";
type Entry = { key: string; state: "started" | "done"; outcome?: Outcome };

// #region effect-log
/** The state of one operation: its last log entry's outcome, or `unknown` when the last entry is a start. */
function stateOf(logFile: string, key: string): "none" | Outcome {
  const entries = readFileSync(logFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      // A kill during a write can leave a torn last line, which says nothing, so it is skipped.
      try {
        return [JSON.parse(line) as Entry];
      } catch {
        return [];
      }
    })
    .filter((entry) => entry.key === key);
  const last = entries.at(-1);
  if (last === undefined) return "none";
  return last.state === "done" ? (last.outcome ?? "applied") : "unknown";
}
const record = (logFile: string, entry: Entry) => appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
// #endregion

/**
 * A fake payment server. It writes once for each idempotency key and declines order 13 with a 402. `posts` counts every
 * request a key sent, apart from `writes`, which holds each key once, so a second request cannot hide.
 */
function fakeServer() {
  const writes: string[] = [];
  const posts: string[] = [];
  const server: Server = createServer((request, response) => {
    const key = String(request.headers["idempotency-key"] ?? "");
    if (request.method === "GET") {
      response.statusCode = writes.includes(request.url?.slice(1) ?? "") ? 200 : 404;
    } else {
      posts.push(key);
      if (key === "charge:13") {
        response.statusCode = 402;
      } else {
        if (!writes.includes(key)) writes.push(key);
        response.statusCode = 200;
      }
    }
    response.end();
  });
  return { server, writes, posts };
}

// #region write-tool
/** The charge tool: log the key, write, then log the outcome. `crashAfterWrite` kills this process in between. */
function chargeTool(base: string, logFile: string, crashAfterWrite = false) {
  return tool({
    description: "Charge the customer for an order",
    inputSchema: z.object({ order: z.number() }),
    execute: async ({ order }) => {
      const key = `charge:${order}`; // book:note key
      const state = stateOf(logFile, key);
      // A write the log already settled is never sent again: the log answers, whether it applied or was declined.
      if (state !== "none" && state !== "unknown") return { outcome: state, replayed: true };
      if (state === "unknown") {
        // A previous attempt started and never finished: ask the server before writing again.
        const found = await fetch(`${base}/${key}`); // book:note reconcile
        if (found.status === 200) {
          record(logFile, { key, state: "done", outcome: "applied" });
          return { outcome: "applied" as Outcome, reconciled: true };
        }
        // Only a 404 proves the write never reached the server, so only then may it be sent, under the same key.
        if (found.status !== 404) return { outcome: "unknown" as Outcome };
      }
      record(logFile, { key, state: "started" }); // book:note persist
      const response = await fetch(base, { method: "POST", headers: { "idempotency-key": key } });
      if (crashAfterWrite) process.kill(process.pid, "SIGKILL"); // book:note crash
      // Only a definite decline is `not_applied`. Any other failure leaves the write `unknown`.
      const outcome: Outcome = response.ok ? "applied" : response.status === 402 ? "not_applied" : "unknown";
      record(logFile, { key, state: "done", outcome });
      return { outcome };
    },
  });
}
// #endregion

const run = (base: string, logFile: string, order: number, crash = false) => {
  const { model } = scripted([{ tools: [{ name: "charge", input: { order } }] }, "Done."]);
  return generateText({
    model,
    tools: { charge: chargeTool(base, logFile, crash) },
    stopWhen: isStepCount(5),
    prompt: `Charge order ${order}`,
  });
};

if (process.argv[2] === "child") {
  // The crashing process: a different order of events would leave a different log, so it only ever runs the charge.
  await run(process.env.BASE as string, process.env.LOG as string, 42, true);
  process.exit(0);
}

const { server, writes, posts } = fakeServer();
/** How many writes the server has made, and how many requests a key sent; functions, so each check reads them anew. */
const written = () => writes.length;
const postsFor = (key: string) => posts.filter((posted) => posted === key).length;
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const folder = mkdtempSync(join(tmpdir(), "effect-log-"));
const logFile = join(folder, "effects.jsonl");
appendFileSync(logFile, "");

try {
  // The write that works: the key is logged, the server writes once, and the outcome is `applied`.
  {
    const result = await run(base, logFile, 7);
    check(JSON.stringify(result.toolResults[0]?.output) === '{"outcome":"applied"}', "a normal write reports applied");
    check(
      written() === 1 && stateOf(logFile, "charge:7") === "applied",
      "the server wrote once and the log says applied",
    );
  }
  // A repeat of a write that was applied is answered from the log: the server gets no second request.
  {
    const result = await run(base, logFile, 7);
    check(
      JSON.stringify(result.toolResults[0]?.output) === '{"outcome":"applied","replayed":true}' &&
        postsFor("charge:7") === 1,
      "a repeated write is answered from the log and sends no request",
    );
  }
  // The write the server declines: nothing was written, the outcome says so, and a repeat is answered from the log.
  {
    const result = await run(base, logFile, 13);
    check(
      JSON.stringify(result.toolResults[0]?.output) === '{"outcome":"not_applied"}',
      "a declined write reports not_applied",
    );
    check(written() === 1, "a declined write is not a write");
    await run(base, logFile, 13);
    check(postsFor("charge:13") === 1, "a declined write is not sent again");
  }

  // #region crash
  // A child process writes through the same tool and is killed after the server's reply, before it logs the outcome.
  const env = {
    PATH: [dirname(process.execPath), process.env.PATH ?? ""].join(delimiter),
    HOME: folder,
    TMPDIR: tmpdir(),
    LANG: "C.UTF-8",
    NODE_NO_WARNINGS: "1",
    BASE: base,
    LOG: logFile,
  };
  const child: ChildProcess = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), "child"], {
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  // A child that hangs would hold the whole run, so it is killed after a time that a healthy one never needs.
  const timer = setTimeout(() => child.kill("SIGTERM"), CHILD_TIMEOUT_MS);
  let childErrors = "";
  child.stderr?.on("data", (chunk) => {
    childErrors += chunk;
  });
  const signal = await new Promise((done, fail) => {
    child.on("error", fail);
    child.on("exit", (_code, killedBy) => done(killedBy));
  });
  clearTimeout(timer);
  check(signal === "SIGKILL", `the child process was killed mid-write ${childErrors.trim()}`);
  check(written() === 2 && postsFor("charge:42") === 1, "the server had already written once for order 42");
  check(stateOf(logFile, "charge:42") === "unknown", "the log has the key and no outcome, so the state is unknown"); // book:note unknown
  // #endregion

  // #region resume
  // A fresh run of the same tool reads the log, sees the unknown state and asks the server, so nothing is written twice.
  const resumed = await run(base, logFile, 42);
  check(
    JSON.stringify(resumed.toolResults[0]?.output) === '{"outcome":"applied","reconciled":true}',
    "the resume reconciles to applied",
  );
  check(postsFor("charge:42") === 1, "the server received exactly one write request for order 42"); // book:note once
  // #endregion
} finally {
  server.close();
  rmSync(folder, { recursive: true, force: true });
}
