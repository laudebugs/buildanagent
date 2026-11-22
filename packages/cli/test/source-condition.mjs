import { register } from "node:module";

// Loads the hook that keeps pi-schema, whose `source` condition names a file its tarball lacks, on its built files.
register(new URL("./source-condition-hooks.mjs", import.meta.url));
