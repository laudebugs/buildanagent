// Writes schema/session-entry.schema.json from the zod mirror. Run it with `pnpm --filter @buildanagent/protocol schema`
// after a change to the entry union. test/schema.test.ts fails while the committed file differs from this output.
import { writeFileSync } from "node:fs";
import { buildSessionEntrySchema } from "./session-entry-schema.js";

const target = new URL("../schema/session-entry.schema.json", import.meta.url);
writeFileSync(target, `${JSON.stringify(buildSessionEntrySchema(), null, 2)}\n`);
console.log(`wrote ${target.pathname}`);
