/** The tool registry's named error: a `HarnessError` with the code `duplicate_tool` and the name that collided. */
import { HarnessError } from "../errors.js";

/**
 * Thrown by `register()` when a registry already holds a tool, or an alias, by that name. An extension that means to
 * replace a built-in passes `override: true`. An MCP tool whose name needs cleaning gets a hash in its name, and this
 * error is for a final name that is still taken.
 */
export class DuplicateToolError extends HarnessError {
  override readonly name = "DuplicateToolError";
  /** The canonical name or alias that is already taken. */
  readonly toolName: string;

  constructor(toolName: string, why: string) {
    super("duplicate_tool", `the tool name "${toolName}" is already registered: ${why}`);
    this.toolName = toolName;
  }
}
