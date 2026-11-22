#!/usr/bin/env node
// The `buildanagent` command: it hands the process's arguments, streams, environment and folder to `runCli()` and
// exits with the status it returns. Everything else lives in modules a test can drive without a process. `tsc` keeps
// the first line, which makes `dist/bin.js` run as a Node script from the `bin` link a package manager makes.
import process from "node:process";
import { linesOf, runCli } from "./index.js";

const lines = linesOf(process.stdin)[Symbol.asyncIterator]();

const status = await runCli(process.argv.slice(2), {
  io: {
    write: (text) => process.stdout.write(text),
    error: (text) => process.stderr.write(text),
    readLine: async () => {
      const next = await lines.next();
      return next.done === true ? undefined : next.value;
    },
    env: process.env,
    cwd: process.cwd(),
  },
});
process.exitCode = status;
// A chat that ended on `/exit` leaves standard input open, which would keep the process alive.
process.stdin.destroy();
