// Copies the repo's licence files into the package being packed. Each package's `prepack` script runs it with the
// package directory as its working directory, so the tarball carries LICENSE, LICENSE-APACHE and LICENSE-MIT while
// the repo keeps one copy of each at its root. The copies are gitignored.
import { copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const file of ["LICENSE", "LICENSE-APACHE", "LICENSE-MIT"]) {
  copyFileSync(path.join(root, file), path.join(process.cwd(), file));
}
