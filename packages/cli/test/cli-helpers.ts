// Shared by the CLI tests: a terminal that records what a command writes and feeds it lines, a state folder per
// test, a scripted model, and a `refund` tool that always asks a person.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CliIo, type CliOptions, runCli } from "@buildanagent/cli";
import { createModel, type Model } from "@buildanagent/gateway";
import type { ToolRegistration } from "@buildanagent/harness/tools";
import { defineTool, type ToolDefinition } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";

export type Steps = ConstructorParameters<typeof ScriptedModel>[0];

/** A terminal whose input is `lines` and whose output is kept. */
export interface Terminal {
  readonly io: CliIo;
  readonly stdout: string[];
  readonly stderr: string[];
  /** Standard output split into lines, without the trailing empty one. */
  lines(): string[];
}

export function terminal(input: readonly string[] = [], env: Record<string, string> = {}): Terminal {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const queue = [...input];
  const io: CliIo = {
    write: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
    readLine: async () => queue.shift(),
    env: { HOME: "/nonexistent-home", ...env },
    cwd: "/work",
  };
  return {
    io,
    stdout,
    stderr,
    lines: () =>
      stdout
        .join("")
        .split("\n")
        .filter((line) => line !== ""),
  };
}

/** A fresh state folder, removed by `cleanup()`. */
export function stateDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "cli-state-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function scripted(steps: Steps): { model: Model; adapter: ScriptedModel } {
  const adapter = new ScriptedModel(steps);
  return { adapter, model: createModel({ adapter, id: "scripted-model", retries: 0 }) as Model };
}

export const reply = (text: string) => ({ content: [{ type: "text" as const, text }] });
export const callTool = (callId: string, name: string, input: unknown) => ({
  type: "tool_call" as const,
  callId,
  name,
  input,
});

/** A tool that records each input it ran with and answers with a fixed text. */
export function recordingTool(name: string, ran: unknown[]): ToolRegistration {
  const definition = defineTool({
    name,
    description: `The ${name} tool.`,
    inputSchema: { type: "object", properties: {} },
    async execute(input) {
      ran.push(input);
      return { content: [{ type: "text", text: `${name} done` }] };
    },
  }) as ToolDefinition<unknown, unknown, unknown>;
  return { name, source: "builtin", definition };
}

/** Runs the CLI against `term` and `dir`, with `--state-dir` added. */
export function cli(
  term: Terminal,
  dir: string,
  argv: readonly string[],
  options: Omit<CliOptions, "io"> = {},
): Promise<number> {
  return runCli([...argv, "--state-dir", dir], { io: term.io, ...options });
}

/** The JSON objects of a `--json` run's standard output. */
export function jsonLines(term: Terminal): Record<string, unknown>[] {
  return term.lines().map((line) => JSON.parse(line) as Record<string, unknown>);
}
