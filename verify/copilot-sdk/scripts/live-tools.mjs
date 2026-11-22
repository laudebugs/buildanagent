// Which tools a live request from the Copilot runtime may offer (scripts/live/proxy.mjs). sandbox-preload.mjs offers a
// live session only its own custom tools, so a name shaped like one of the runtime's built-ins means something went
// wrong. The proxy's denyHostTools adds the names and types every harness refuses.
import { BUILTIN_DENY } from "./mock-model.mjs";

/** Whether a live request may offer the tool `name`. */
export const liveTool = (name) => !BUILTIN_DENY.test(name);
