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
    resumeTriage: "a function of the support-triage capstone in examples/",
    startTriage: "a function of the support-triage capstone in examples/",
    steer: "a Run method",
    toStandardJsonSchema: "a function of @valibot/to-json-schema",
  },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(PACKAGE_DIR, CONFIG));
