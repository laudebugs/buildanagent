/**
 * The tool types: what a tool declares, what its `execute` receives and returns, and the failures the pipeline
 * reports to the model (SDK plan §3.3; agent-SDK guide §4).
 */
import type { ContentBlock, ModelContent } from "@buildanagent/gateway";
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";
import type { Clock } from "../testing/determinism.js";
import type { WriteOutcome } from "../vendor/agent-safety/outcome.js";

/** A JSON Schema object, draft 2020-12 or draft 7, such as `{ type: "object", properties: { … } }`. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/**
 * A tool's input schema: a Standard Schema that can also describe itself as JSON Schema (Zod 4.2 or later, ArkType,
 * or Valibot through `toStandardJsonSchema()` from `@valibot/to-json-schema`), or a raw JSON Schema object. A raw schema whose `$schema` names draft 7 is checked as draft 7, and
 * any other as draft 2020-12.
 */
export type ToolSchema<I> = (StandardSchemaV1<unknown, I> & StandardJSONSchemaV1<unknown, I>) | JsonSchema;

/**
 * One reason a tool input failed its schema. `path` is a JSON Pointer, such as `/items/0/sku`, or `""` for the whole
 * input.
 */
export interface SchemaIssue {
  readonly path: string;
  readonly message: string;
  /** The JSON Schema keyword that failed, such as `required`, when the validator reports one. */
  readonly keyword?: string;
}

/** The fields every tool failure carries. `input` is the arguments the model sent. */
interface FailureBase {
  readonly tool: string;
  readonly callId: string;
  readonly input: unknown;
}

/**
 * A failed tool call, as the error formatter receives it. `unknown_tool`: the model named a tool that doesn't exist.
 * `invalid_input`: the arguments failed the schema, even after repair. `execution_error`: `execute` threw; with
 * `redactErrors`, `message` is a fixed line and the thrown message is only in the result's `details`. `truncated`:
 * the response was cut off at the output limit, so the call was not run. `not_run`: the call was not run because the
 * response ended in an error (`response_error`) or was aborted (`response_aborted`), or the run was cancelled before
 * the call started (`run_aborted`).
 */
export type ToolFailure =
  | (FailureBase & { readonly kind: "unknown_tool"; readonly availableTools: readonly string[] })
  | (FailureBase & { readonly kind: "invalid_input"; readonly issues: readonly SchemaIssue[] })
  | (FailureBase & { readonly kind: "execution_error"; readonly message: string; readonly redacted: boolean })
  | (FailureBase & { readonly kind: "truncated" })
  | (FailureBase & {
      readonly kind: "not_run";
      readonly reason: "response_error" | "response_aborted" | "run_aborted";
    });

/**
 * Declares that a tool changes the world, such as sending an email. A tool without `effect` counts as read-only, so
 * a run that crashes mid-call may safely run it again. `businessKey` names the real-world operation, such as
 * `refund:<order id>`, so the same write is recognised across retries and sessions.
 */
export interface ToolEffect<I> {
  readonly kind: "write";
  businessKey?(input: I): string;
}

/** Whether a tool is sent to the model: `direct`, `deferred` or `hidden`. */
export type ToolExposure = "direct" | "deferred" | "hidden";

/** What a tool's `execute` receives besides its input. */
export interface ToolContext {
  readonly runId: string;
  readonly callId: string;
  /** Fires when the run is aborted. */
  readonly signal: AbortSignal;
  /** How deeply this run is nested inside other agents' tool calls; 0 for a top-level run. */
  readonly depth: number;
  /** The deepest nesting allowed; a tool that starts another agent refuses at this depth. */
  readonly maxDepth: number;
  readonly clock: Clock;
  /** Reports progress for a user interface, such as rows processed so far. The model never sees it. */
  update(details: unknown): void;
}

/**
 * What a tool returns. `content` is what the model reads, `details` is for logs and user interfaces, and
 * `structured` is typed data for your code; only `content` reaches the model. `isError` marks a failure for the model.
 * `terminate` asks the run to end after this step. `pause` asks the user a question. `outcome` reports what a write
 * did: any kind except `applied` sets `isError`, and the model reads the outcome's sentence and fields before
 * `content`.
 */
export interface ToolResult<S = unknown> {
  readonly content: readonly ModelContent[];
  readonly details?: unknown;
  readonly structured?: S;
  readonly isError?: boolean;
  readonly terminate?: boolean;
  readonly pause?: { readonly kind: "clarification"; readonly question: string };
  readonly outcome?: WriteOutcome;
}

/**
 * A tool the model can call. `I` is the input `execute` receives after validation, and `S` the type of `structured`.
 *
 * Every call runs the same steps: the name is resolved, the input is coerced and validated, `repair` gets one chance
 * to fix invalid input, then `execute` runs. A failure the model caused, such as an unknown tool, invalid input or
 * a throwing `execute`, returns an error result to the model. A result that isn't a list of text and image blocks,
 * or that carries an invalid write outcome, throws an `SdkError` with code `invalid_tool_result`.
 */
export interface ToolDefinition<I = unknown, S = unknown> {
  /** 1 to 64 characters from `A-Z`, `a-z`, `0-9`, `_` and `-`. */
  readonly name: string;
  readonly description: string;
  /**
   * `function` (the default) runs in your process. The other kinds are for tools that a provider defines or runs:
   * `dynamic` tools have a schema known only at run time, such as one from an MCP server.
   */
  readonly kind?: "function" | "dynamic" | "provider-local" | "provider-executed";
  readonly inputSchema: ToolSchema<I>;
  /**
   * Whether the model is sent this tool. `direct` (the default) sends it with every model call. A `deferred` or
   * `hidden` tool is left out of every request, and a call the model makes to it anyway gets the unknown-tool error
   * result.
   */
  readonly exposure?: ToolExposure;
  /** Marks a tool that changes the world. A tool without it counts as read-only. */
  readonly effect?: ToolEffect<I>;
  /**
   * Called once when the input fails its schema, with the coerced input and the issues. Return fixed input to
   * validate again, or `undefined` to report the failure to the model.
   */
  repair?(e: { readonly input: unknown; readonly issues: readonly SchemaIssue[] }): Promise<unknown>;
  /**
   * Builds the content the model reads for a failed call, in place of the default text, which lists the issues and
   * the received arguments and tells the model not to substitute invented data. It runs synchronously; if it throws
   * or returns anything but a list of text and image blocks, the model reads the default text instead.
   */
  formatError?(failure: ToolFailure): readonly ModelContent[];
  /**
   * When true, an error thrown by `execute` reaches the model as a fixed line, and its message goes only to the
   * result's `details`. Default false.
   */
  readonly redactErrors?: boolean;
  execute(input: I, ctx: ToolContext): Promise<ToolResult<S>>;
}

/** A tool call block from an assistant message. */
export type ToolCall = Extract<ContentBlock, { type: "tool_call" }>;
