// The SDK's docs checks (../../scripts/package-docs.mjs): every TypeScript block in README.md type-checks, every
// export name it documents is in the SDK's or the gateway's declaration files, unstable names carry `experimental_`,
// and llms.txt is current. test/docs-check.test.ts also checks that the README lists every string in CAPABILITIES.
//
//   node packages/sdk/scripts/docs-check.mjs           fails on any problem, a stale llms.txt included
//   node packages/sdk/scripts/docs-check.mjs --write   rewrites llms.txt first
//
// test/docs-check.test.ts runs the same checks under `pnpm test`.
import { fileURLToPath } from "node:url";
import { main } from "../../../scripts/package-docs.mjs";

export const PACKAGE_DIR = fileURLToPath(new URL("../", import.meta.url));

export const CONFIG = {
  globals: "scripts/readme-globals.ts",
  // The README names the gateway's exports too, such as `createModel()`.
  alsoNames: ["../gateway"],
  // Prose names that look like exports but are not this package's: members, other packages' names and the capstone's
  // own functions.
  notExports: {
    AsyncLocalStorage: "Node's node:async_hooks class",
    Tracer: "OpenTelemetry's tracer type",
    assertComplete: "a ScriptedModel, ReplayModel and scriptedApprovals() method",
    followUp: "a Run method",
    budgetBlock: "a function of the reference loop in reference-loop/",
    callModel: "a function of the reference loop in reference-loop/",
    decide: "a function of the reference loop in reference-loop/",
    drive: "a function of the reference loop in reference-loop/",
    execute: "a function of the reference loop in reference-loop/",
    failedCheck: "a function of the reference loop in reference-loop/",
    on: "a Run method",
    pause: "a function of the reference loop in reference-loop/",
    runCall: "a function of the reference loop in reference-loop/",
    runCalls: "a function of the reference loop in reference-loop/",
    settle: "a function of the reference loop in reference-loop/",
    start: "a function of the reference loop in reference-loop/",
    step: "a function of the reference loop in reference-loop/",
    stopCheck: "a function of the reference loop in reference-loop/",
    stuckReason: "a function of the reference loop in reference-loop/",
    verify: "a signer method",
    resumeTriage: "a function of the support-triage capstone in examples/",
    startTriage: "a function of the support-triage capstone in examples/",
    steer: "a Run method",
    toStandardJsonSchema: "a function of @valibot/to-json-schema",
  },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(PACKAGE_DIR, CONFIG));
