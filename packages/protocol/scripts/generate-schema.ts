// Writes schema/session-entry.schema.json and schema/protocol.schema.json from the zod mirrors. Run it with
// `pnpm --filter @buildanagent/protocol schema` after a change to the entry union or the messages. The schema tests
// fail while a committed file differs from this output.
import { writeFileSync } from "node:fs";
import { buildProtocolSchema } from "./protocol-schema.js";
import { buildSessionEntrySchema } from "./session-entry-schema.js";

for (const [name, schema] of [
  ["session-entry", buildSessionEntrySchema()],
  ["protocol", buildProtocolSchema()],
] as const) {
  const target = new URL(`../schema/${name}.schema.json`, import.meta.url);
  writeFileSync(target, `${JSON.stringify(schema, null, 2)}\n`);
  console.log(`wrote ${target.pathname}`);
}
