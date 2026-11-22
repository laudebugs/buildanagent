#!/usr/bin/env node
// The `buildanagent` command. It only prints its help so far, so a packed and installed CLI can be checked to start
// offline; the commands that run the harness come later. `tsc` keeps the first line, which makes `dist/bin.js` run
// as a Node script from the `bin` link a package manager makes.
import process from "node:process";

const HELP = `Usage: buildanagent [--help]

Runs the buildanagent harness in a terminal. No commands run yet.

Options:
  -h, --help  Print this help and exit.
`;

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  process.stdout.write(HELP);
} else {
  process.stderr.write(`buildanagent: unknown argument ${JSON.stringify(args[0])}\n\n${HELP}`);
  process.exitCode = 2;
}
