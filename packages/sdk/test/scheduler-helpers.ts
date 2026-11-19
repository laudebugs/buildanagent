// Fixtures for the scheduling tests: tools whose start and end the test controls with deferreds, never with timers.
import { defineTool, type ToolDefinition, type ToolResult } from "@buildanagent/sdk";
import { fixedClock } from "../src/testing/determinism.js";
import type { AnyTool, PipelineContext } from "../src/tools/pipeline.js";
import { pipelineContext } from "./tool-helpers.js";

export interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

export function deferred(): Deferred {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Lets every promise reaction that is already queued run, so a test can show that something did not happen. */
export async function flush(): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
}

export interface ProbeInput {
  readonly id: string;
  readonly key?: string;
}

/**
 * Records when each call starts and ends, from a clock that advances 1 ms on every reading, so the times order the
 * events. A call ends when the test releases it.
 */
export class Probe {
  readonly log: string[] = [];
  readonly times = new Map<string, { start?: string; end?: string }>();
  readonly signals = new Map<string, AbortSignal>();
  readonly clock = fixedClock("2026-11-19T12:00:00.000Z", 1);
  private readonly gates = new Map<string, { started: Deferred; release: Deferred }>();

  private gate(id: string) {
    const known = this.gates.get(id) ?? { started: deferred(), release: deferred() };
    this.gates.set(id, known);
    return known;
  }

  /** Resolves once the call with this id has started. */
  started(id: string): Promise<void> {
    return this.gate(id).started.promise;
  }

  /** Lets the call with this id finish. */
  release(id: string): void {
    this.gate(id).release.resolve();
  }

  tool(overrides: Partial<ToolDefinition<ProbeInput>> = {}): AnyTool {
    return defineTool<ProbeInput>({
      name: "probe",
      description: "Records its start and end.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" }, key: { type: "string" } },
        required: ["id"],
      },
      execute: async (input, ctx): Promise<ToolResult> => {
        const gate = this.gate(input.id);
        this.signals.set(input.id, ctx.signal);
        this.times.set(input.id, { start: ctx.clock.now() });
        this.log.push(`start ${input.id}`);
        gate.started.resolve();
        await gate.release.promise;
        const times = this.times.get(input.id);
        if (times !== undefined) times.end = ctx.clock.now();
        this.log.push(`end ${input.id}`);
        return { content: [{ type: "text", text: `done ${input.id}` }] };
      },
      ...overrides,
    }) as AnyTool;
  }

  context(overrides: Partial<PipelineContext> = {}): PipelineContext {
    return pipelineContext({ clock: this.clock, ...overrides });
  }
}
