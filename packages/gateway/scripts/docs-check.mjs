// The gateway's docs checks (../../scripts/package-docs.mjs): every TypeScript block in README.md type-checks, every
// export name it documents is in the declaration files, unstable names carry `experimental_`, and llms.txt is current.
//
//   node packages/gateway/scripts/docs-check.mjs           fails on any problem, a stale llms.txt included
//   node packages/gateway/scripts/docs-check.mjs --write   rewrites llms.txt first
//
// test/docs-check.test.ts runs the same checks under `pnpm test`.
import { fileURLToPath } from "node:url";
import { main } from "../../../scripts/package-docs.mjs";

export const PACKAGE_DIR = fileURLToPath(new URL("../", import.meta.url));

export const CONFIG = {
  globals: "scripts/readme-globals.ts",
  // Prose names that look like exports but are not this package's: members, header values and globals.
  notExports: {
    Basic: "an Authorization scheme the credential strippers redact",
    Bearer: "an Authorization scheme the credential strippers redact",
    restore: "a ToolNameMap method",
    sanitize: "a ToolNameMap method",
    stream: "the ModelAdapter method",
  },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(PACKAGE_DIR, CONFIG));
