// Type-checks the app with the repo root's TypeScript, which the packages build with. The app's own `typescript` is 6.0.3,
// pinned for TypeDoc alone, so `tsc` on the path would check with the wrong compiler.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const rootRequire = createRequire(new URL("../../../package.json", import.meta.url));
const tsc = join(dirname(rootRequire.resolve("typescript/package.json")), "bin", "tsc");
const result = spawnSync(process.execPath, [tsc, "-p", "tsconfig.json"], { stdio: "inherit" });
process.exit(result.status ?? 1);
