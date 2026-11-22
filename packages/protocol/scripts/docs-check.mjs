// The docs checks for the protocol package's README (../../scripts/package-docs.mjs): every TypeScript block in README.md type-checks,
// every block of more than five lines comes from a file in examples/, every export name it documents is in the
// declaration files, unstable names carry `experimental_`, and llms.txt is current.
//
//   node packages/protocol/scripts/docs-check.mjs           fails on any problem, a stale llms.txt included
//   node packages/protocol/scripts/docs-check.mjs --write   rewrites llms.txt first
//
// test/docs-check.test.ts runs the same checks under `pnpm test`.
import { fileURLToPath } from "node:url";
import { main } from "../../../scripts/package-docs.mjs";

export const PACKAGE_DIR = fileURLToPath(new URL("../", import.meta.url));

export const CONFIG = {
  globals: "scripts/readme-globals.ts",
  alsoNames: ["../gateway", "../sdk"],
  blocksFromExamples: true,
  // Prose names that look like exports but are not this package's: members, fields, variables and other packages' names.
  notExports: {
    NotOptedIn: "an ErrorCodes code",
    QueueFull: "an ErrorCodes code",
    SessionLocked: "an ErrorCodes code",
    end: "a JsonlFramer method",
  },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(PACKAGE_DIR, CONFIG));
