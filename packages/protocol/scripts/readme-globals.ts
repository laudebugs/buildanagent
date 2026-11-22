// The names the README's TypeScript blocks use without defining them, for scripts/docs-check.mjs, which type-checks
// each block as a module beside this file. A block's own imports and declarations shadow these.
import type * as protocol from "@buildanagent/protocol";

declare global {
  const JsonlFramer: typeof protocol.JsonlFramer;

  const chunk: Uint8Array;
  const line: string;
}
