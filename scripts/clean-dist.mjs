// Deletes the dist/ folder of the package being built. Each package's `build` script runs it before `tsc`, with the
// package directory as its working directory, because `tsc` only adds and overwrites files: a module deleted or
// renamed in src/ would otherwise leave its old dist/ files behind, and `pnpm pack` would ship them.
import { rmSync } from "node:fs";
import path from "node:path";

rmSync(path.join(process.cwd(), "dist"), { recursive: true, force: true });
