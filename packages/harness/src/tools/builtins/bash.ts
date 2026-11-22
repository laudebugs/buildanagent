/**
 * `bash`: runs a shell command through `Sandbox.exec()` only, never on the host, with the environment the host chose
 * and a timeout. Its output reaches the model through the context policy's write cap like every tool result, and the
 * sandbox drops what passes the per-stream bound first, so one command can't hold the host's memory.
 */
import { defineTool, type ToolDefinition, type ToolResult } from "@buildanagent/sdk";
import type { ExecResult, Sandbox } from "../../sandbox/types.js";
import { BUILTIN_TOOL_DEFAULTS } from "./descriptions.js";
import { deniedResult, errorResult, failureResult, textResult } from "./results.js";

interface BashInput {
  readonly command: string;
  readonly timeout_ms?: number;
}

/** The text the model reads for a command that ran: its output, its standard error and how it ended. */
function report(result: Extract<ExecResult, { exitCode: number }>, timeoutMs: number): ToolResult {
  const { maxOutputBytes } = BUILTIN_TOOL_DEFAULTS.bash;
  const parts = [result.stdout];
  if (result.stderr !== "") parts.push(`[stderr]\n${result.stderr}`);
  if (result.truncated === true) parts.push(`[output past ${maxOutputBytes} bytes per stream was dropped]`);
  // Only the sandbox's flag means the timeout stopped it: a command may exit with 124 itself, as `timeout` does.
  const timedOut = result.timedOut === true;
  const ending = timedOut
    ? `[timed out after ${timeoutMs} ms]`
    : `[exit code ${result.exitCode}${result.signal === undefined ? "" : `, killed by ${result.signal}`}]`;
  parts.push(ending);
  const text = parts.filter((part) => part !== "").join("\n");
  const details = {
    exitCode: result.exitCode,
    ...(result.signal === undefined ? {} : { signal: result.signal }),
    ...(timedOut ? { timedOut } : {}),
  };
  return timedOut ? { ...errorResult(text), details } : textResult(text, details);
}

/** The `bash` tool, which runs each command with `env` as its whole environment. */
export function bashTool(
  sandbox: Sandbox,
  env: Readonly<Record<string, string>>,
): ToolDefinition<unknown, unknown, unknown> {
  const { defaultTimeoutMs, maxTimeoutMs, maxOutputBytes, description } = BUILTIN_TOOL_DEFAULTS.bash;
  return defineTool<BashInput>({
    name: "bash",
    description,
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", minLength: 1, description: "The command to run, as bash reads it." },
        timeout_ms: {
          type: "integer",
          minimum: 1,
          maximum: maxTimeoutMs,
          description: `Milliseconds before the command is stopped. Default ${defaultTimeoutMs}.`,
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
    firstParty: true,
    effect: { kind: "write" },
    // A command may read or change anything in the workspace, so the calls around it wait their turn.
    executionMode: "sequential",
    async execute(input, ctx) {
      const timeoutMs = Math.min(input.timeout_ms ?? defaultTimeoutMs, maxTimeoutMs);
      let result: ExecResult;
      try {
        result = await sandbox.exec(["bash", "-c", input.command], {
          env,
          signal: ctx.signal,
          timeoutMs,
          maxOutputBytes,
        });
      } catch (error) {
        return failureResult(error);
      }
      if ("denied" in result) return deniedResult(result.denied);
      return report(result, timeoutMs);
    },
  }) as ToolDefinition<unknown, unknown, unknown>;
}
