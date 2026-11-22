// Rewrites the three registers in their canonical layout: one entry per line, sorted by id. Run it after adding an
// entry by hand; `test/registers.test.ts` fails while a register differs from it.
import { fileURLToPath } from "node:url";
import { writeRegisters } from "../src/book/register-format.js";

const changed = writeRegisters(fileURLToPath(new URL("..", import.meta.url)));
console.log(changed.length === 0 ? "the registers are already in canonical form" : `rewrote ${changed.join(", ")}`);
