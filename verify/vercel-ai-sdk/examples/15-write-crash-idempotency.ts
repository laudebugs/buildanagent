// A write tool that can fail halfway: it persists an idempotency key before it calls the server, reports an outcome,
// and after a crash between the server's write and the result it finds the key, reports `unknown`, asks the server
// instead of writing again, and the server sees one write. The effect log is a small file here; a package replaces it.
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

/** What a write can have done: it took effect, it didn't, it was undone, part of it took effect, or nobody can tell. */
type Outcome = "applied" | "not_applied" | "compensated" | "partial" | "unknown";
type Entry = { key: string; state: "started" | "done"; outcome?: Outcome };

// #region effect-log
/** The state of one operation, read from its log: `unknown` when it started and nothing says how it ended. */
function stateOf(logFile: string, key: string): "none" | Outcome {
  const entries = readFileSync(logFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Entry);
  const mine = entries.filter((entry) => entry.key === key);
  const done = mine.find((entry) => entry.state === "done");
  if (done) return done.outcome ?? "applied";
  return mine.length > 0 ? "unknown" : "none";
}
const record = (logFile: string, entry: Entry) => appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
// #endregion

/** A fake payment server: it writes once for each idempotency key, declines order 13, and answers lookups. */
function fakeServer() {
  const writes: string[] = [];
  const server: Server = createServer((request, response) => {
    const key = String(request.headers["idempotency-key"] ?? "");
    if (request.method === "GET") {
      response.statusCode = writes.includes(request.url?.slice(1) ?? "") ? 200 : 404;
    } else if (key.endsWith(":13")) {
      response.statusCode = 402;
    } else {
      if (!writes.includes(key)) writes.push(key);
      response.statusCode = 200;
    }
    response.end();
  });
  return { server, writes };
}

// #region write-tool
/** The charge tool: log the key, write, then log the outcome. `crashAfterWrite` kills this process in between. */
function chargeTool(base: string, logFile: string, crashAfterWrite = false) {
  return tool({
    description: "Charge the customer for an order",
    inputSchema: z.object({ order: z.number() }),
    execute: async ({ order }) => {
      const key = `charge:${order}`; // book:note key
      if (stateOf(logFile, key) === "unknown") {
        // A previous attempt started and never finished: ask the server before writing again.
        const found = await fetch(`${base}/${key}`); // book:note reconcile
        record(logFile, { key, state: "done", outcome: found.ok ? "applied" : "not_applied" });
        return { outcome: found.ok ? "applied" : "not_applied", reconciled: true };
      }
      record(logFile, { key, state: "started" }); // book:note persist
      const response = await fetch(base, { method: "POST", headers: { "idempotency-key": key } });
      if (crashAfterWrite) process.kill(process.pid, "SIGKILL"); // book:note crash
      const outcome: Outcome = response.ok ? "applied" : "not_applied";
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

const { server, writes } = fakeServer();
/** How many writes the server has made; a function, so each check reads the current count. */
const written = () => writes.length;
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const folder = mkdtempSync(join(tmpdir(), "effect-log-"));
const logFile = join(folder, "effects.jsonl");
appendFileSync(logFile, "");

// The write that works: the key is logged, the server writes once, and the outcome is `applied`.
{
  const result = await run(base, logFile, 7);
  check(JSON.stringify(result.toolResults[0]?.output) === '{"outcome":"applied"}', "a normal write reports applied");
  check(
    written() === 1 && stateOf(logFile, "charge:7") === "applied",
    "the server wrote once and the log says applied",
  );
}
// The write the server declines: nothing was written, and the outcome says so.
{
  const result = await run(base, logFile, 13);
  check(
    JSON.stringify(result.toolResults[0]?.output) === '{"outcome":"not_applied"}',
    "a declined write reports not_applied",
  );
  check(written() === 1, "a declined write is not a write");
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
  stdio: "ignore",
});
const signal = await new Promise((done) => child.on("exit", (_code, killedBy) => done(killedBy)));
check(signal === "SIGKILL", "the child process was killed mid-write");
check(written() === 2, "the server had already written once for order 42");
check(stateOf(logFile, "charge:42") === "unknown", "the log has the key and no outcome, so the state is unknown"); // book:note unknown
// #endregion

// #region resume
// A fresh run of the same tool reads the log, sees the unknown state and asks the server, so nothing is written twice.
const resumed = await run(base, logFile, 42);
check(
  JSON.stringify(resumed.toolResults[0]?.output) === '{"outcome":"applied","reconciled":true}',
  "the resume reconciles to applied",
);
check(
  written() === 2 && writes.filter((key) => key === "charge:42").length === 1,
  "the server saw exactly one write for order 42",
); // book:note once
// #endregion

server.close();
rmSync(folder, { recursive: true, force: true });
