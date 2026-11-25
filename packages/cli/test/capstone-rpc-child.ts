// The second process of the capstone's rpc test: `buildanagent rpc` on the process's own standard streams, as the
// binary runs it, with the capstone's tools and a scripted model passed through `runCli()`'s options, which the binary's
// flags can't carry. It shares only the state folder with the first process.
import "@buildanagent/gateway/testing/setup";
import process from "node:process";
import { runCli } from "@buildanagent/cli";
import { TRIAGE_RULES, triageTools } from "./capstone-tools.js";
import { reply, scripted } from "./cli-helpers.js";

const [stateDir, pagesFile] = process.argv.slice(2) as [string, string];
const { model } = scripted([reply("Escalated to the on-call engineer.")]);
const status = await runCli(["rpc", "--state-dir", stateDir], {
  io: {
    write: (text) => process.stdout.write(text),
    error: (text) => process.stderr.write(text),
    readLine: async () => undefined,
    env: process.env,
    cwd: process.cwd(),
    streams: { input: process.stdin, output: process.stdout },
  },
  model,
  tools: triageTools(pagesFile),
  rules: TRIAGE_RULES,
});
process.exitCode = status;
