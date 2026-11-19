/**
 * `defineTool()`, `outputTool()` and `clarificationTool()`: each checks a definition once and prepares its schema,
 * so a broken tool throws when it is defined rather than when the model first calls it.
 */
import { assertCanonicalName, type WireTool } from "@buildanagent/gateway";
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";
import { SdkError } from "../errors.js";
import { type PreparedSchema, prepareSchema } from "./schema.js";
import type { ToolDefinition, ToolResult } from "./types.js";

const EXPOSURES: readonly string[] = ["direct", "deferred", "hidden"];
const EXECUTION_MODES: readonly string[] = ["parallel", "sequential"];

// Keyed by the frozen definition, so a schema is compiled once however many runs use the tool.
const prepared = new WeakMap<object, PreparedSchema>();

function invalid(message: string, cause?: unknown): SdkError {
  return new SdkError("invalid_tool_definition", message, cause === undefined ? {} : { cause });
}

function checkName(name: unknown): string {
  if (typeof name !== "string") throw invalid("a tool's name must be a string");
  try {
    assertCanonicalName(name);
  } catch (cause) {
    throw invalid(cause instanceof Error ? cause.message : String(cause), cause);
  }
  return name;
}

/**
 * Checks a tool and returns its prepared schema, preparing it on first use. Throws an `SdkError`, code
 * `invalid_tool_definition`, for a bad name, a missing description or `execute`, an unknown exposure, or an unusable
 * schema.
 */
export function preparedSchemaOf(tool: ToolDefinition<unknown, unknown>): PreparedSchema {
  const known = prepared.get(tool);
  if (known !== undefined) return known;
  const name = checkName(tool.name);
  if (typeof tool.description !== "string") throw invalid(`tool "${name}": description must be a string`);
  if (typeof tool.execute !== "function") throw invalid(`tool "${name}": execute must be a function`);
  if (tool.exposure !== undefined && !EXPOSURES.includes(tool.exposure)) {
    throw invalid(`tool "${name}": exposure must be "direct", "deferred" or "hidden"`);
  }
  if (tool.executionMode !== undefined && !EXECUTION_MODES.includes(tool.executionMode)) {
    throw invalid(`tool "${name}": executionMode must be "parallel" or "sequential"`);
  }
  if (tool.resourceKey !== undefined && typeof tool.resourceKey !== "function") {
    throw invalid(`tool "${name}": resourceKey must be a function`);
  }
  if (tool.progressKey !== undefined && typeof tool.progressKey !== "function") {
    throw invalid(`tool "${name}": progressKey must be a function`);
  }
  const schema = prepareSchema(name, tool.inputSchema);
  prepared.set(tool, schema);
  return schema;
}

/**
 * Defines a tool. The returned copy is frozen, and its schema is compiled now, so a mistake surfaces here.
 *
 * Throws an `SdkError`, code `invalid_tool_definition`, when the name breaks the tool-name rule (1 to 64 characters
 * from `A-Z`, `a-z`, `0-9`, `_` and `-`), the description or `execute` is missing, `exposure` is not one of its three
 * values, `executionMode` is neither `parallel` nor `sequential`, `resourceKey` or `progressKey` is not a function, a raw JSON Schema
 * does not compile or names a draft other than 2020-12 or 7, or a Standard Schema cannot describe itself as JSON
 * Schema.
 */
export function defineTool<I, S = unknown>(definition: ToolDefinition<I, S>): ToolDefinition<I, S> {
  const tool = Object.freeze({ ...definition });
  // Method parameters are bivariant, so a tool of any input type is a ToolDefinition<unknown, unknown>.
  preparedSchemaOf(tool as ToolDefinition<unknown, unknown>);
  return tool;
}

/** The options of `outputTool()`. */
export interface OutputToolOptions<S> {
  readonly name: string;
  /** The schema of the final answer. A Standard Schema that can describe itself as JSON Schema, such as Zod 4.2's. */
  readonly schema: StandardSchemaV1<unknown, S> & StandardJSONSchemaV1<unknown, S>;
  /** Defaults to a line asking the model to call the tool once, with its final answer. */
  readonly description?: string;
}

const OUTPUT_DESCRIPTION = "Submit your final answer as this tool's input. Call it once, when the task is done.";
const OUTPUT_ACCEPTED = "The final answer was accepted.";

/**
 * Defines a tool whose input is the run's final answer. A call whose input passes `schema` ends the run, with the
 * validated value as the result's `structured` field. A call that fails it returns the schema's issues to the model
 * as an error result, so the model can correct the answer and call again.
 */
export function outputTool<S>(options: OutputToolOptions<S>): ToolDefinition<S, S> {
  return defineTool<S, S>({
    name: options.name,
    description: options.description ?? OUTPUT_DESCRIPTION,
    inputSchema: options.schema,
    async execute(input): Promise<ToolResult<S>> {
      return { content: [{ type: "text", text: OUTPUT_ACCEPTED }], structured: input, terminate: true };
    },
  });
}

/** The options of `clarificationTool()`. */
export interface ClarificationToolOptions {
  /** Defaults to `ask_user`. */
  readonly name?: string;
}

const CLARIFICATION_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    question: Object.freeze({ type: "string", minLength: 1, description: "The question to ask the user." }),
  }),
  required: Object.freeze(["question"]),
  additionalProperties: false,
});

/**
 * Defines a tool the model calls to ask the user a question. Its result carries the question as a `pause` of kind
 * `clarification`, and a run that gets it ends with `stopReason: "stopped"` and `stoppedBy: "clarification"`.
 */
export function clarificationTool(options: ClarificationToolOptions = {}): ToolDefinition<{ question: string }, never> {
  return defineTool<{ question: string }, never>({
    name: options.name ?? "ask_user",
    description: "Ask the user a question when you cannot continue without their answer.",
    inputSchema: CLARIFICATION_SCHEMA,
    async execute({ question }) {
      return {
        content: [{ type: "text", text: "The question was sent to the user." }],
        pause: { kind: "clarification", question },
      };
    },
  });
}

/** The tool as one model call sends it: its name, description and input JSON Schema. */
export function toWireTool(tool: ToolDefinition<unknown, unknown>): WireTool {
  const { jsonSchema } = preparedSchemaOf(tool);
  // Adapters only read the schema; the cast drops the `readonly` that keeps our own code from changing it.
  return { name: tool.name, description: tool.description, inputSchema: jsonSchema as Record<string, unknown> };
}
