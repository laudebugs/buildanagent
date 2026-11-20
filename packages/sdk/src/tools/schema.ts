/**
 * Schema handling: turns a tool's `inputSchema` into the JSON Schema the model is sent and a validator the pipeline
 * runs. A Standard Schema validates itself and describes itself as JSON Schema; a raw JSON Schema is compiled once
 * with pi-schema, drafts 2020-12 and 7, with format checks on (D7).
 */
import { compile, type Validator } from "@earendil-works/pi-schema";
import { formats } from "@earendil-works/pi-schema/formats";
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";
import { fillTemplate, SDK_DEFAULTS } from "../defaults.js";
import { SdkError } from "../errors.js";
import type { JsonSchema, SchemaIssue, ToolSchema } from "./types.js";

/** The outcome of validating one input: the value `execute` receives, or the issues. */
export type Validation =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly issues: readonly SchemaIssue[] };

/** A tool's schema, ready for the pipeline. */
export interface PreparedSchema {
  /** The JSON Schema the model is sent, and the one coercion reads. */
  readonly jsonSchema: JsonSchema;
  validate(value: unknown): Promise<Validation>;
}

type StandardToolSchema = StandardSchemaV1<unknown, unknown> & StandardJSONSchemaV1<unknown, unknown>;

const DRAFT_7 = /^https?:\/\/json-schema\.org\/draft-07\/schema#?$/;
const DRAFT_2020_12 = /^https?:\/\/json-schema\.org\/draft\/2020-12\/schema#?$/;

function isStandardSchema(schema: ToolSchema<unknown>): schema is StandardToolSchema {
  return "~standard" in schema;
}

// An ArkType schema is a callable function that carries `~standard`, so a function counts when it has that property.
function isSchemaShaped(schema: unknown): schema is ToolSchema<unknown> {
  if (typeof schema === "object") return schema !== null;
  return typeof schema === "function" && "~standard" in schema;
}

function invalid(tool: string, message: string, cause?: unknown): SdkError {
  return new SdkError("invalid_tool_definition", `tool "${tool}": ${message}`, cause === undefined ? {} : { cause });
}

function draftOf(tool: string, schema: JsonSchema): "7" | "2020-12" {
  const declared = schema.$schema;
  if (declared === undefined || (typeof declared === "string" && DRAFT_2020_12.test(declared))) return "2020-12";
  if (typeof declared === "string" && DRAFT_7.test(declared)) return "7";
  throw invalid(tool, `$schema ${JSON.stringify(declared)} is not draft 2020-12 or draft 7`);
}

function prepareJsonSchema(tool: string, schema: JsonSchema): PreparedSchema {
  let validator: Validator<unknown>;
  try {
    validator = compile(schema, { draft: draftOf(tool, schema), formats });
  } catch (cause) {
    if (cause instanceof SdkError) throw cause;
    throw invalid(tool, "its input schema does not compile", cause);
  }
  return {
    jsonSchema: schema,
    async validate(value) {
      if (validator.check(value)) return { ok: true, value };
      const issues = validator.errors(value).map(({ path, keyword, message }) => ({ path, keyword, message }));
      return { ok: false, issues };
    },
  };
}

// RFC 6901: "~" and "/" in a key are escaped as "~0" and "~1".
function pointer(path: StandardSchemaV1.Issue["path"]): string {
  return (path ?? [])
    .map((segment) => {
      const key = typeof segment === "object" ? segment.key : segment;
      const text = typeof key === "symbol" ? (key.description ?? "") : String(key);
      return `/${text.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    })
    .join("");
}

function prepareStandardSchema(tool: string, schema: StandardToolSchema): PreparedSchema {
  let jsonSchema: JsonSchema;
  try {
    jsonSchema = schema["~standard"].jsonSchema.input({ target: "draft-2020-12" });
  } catch (cause) {
    throw invalid(tool, "its Standard Schema cannot describe its input as draft 2020-12 JSON Schema", cause);
  }
  return {
    jsonSchema,
    async validate(value) {
      let result: StandardSchemaV1.Result<unknown>;
      try {
        result = await schema["~standard"].validate(value);
      } catch (error) {
        // A validator that throws is the schema library's failure, not the model's, but the model still needs an
        // error result, so the throw becomes one issue at the root.
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          issues: [{ path: "", message: fillTemplate(SDK_DEFAULTS.toolErrors.validatorThrew, { message }) }],
        };
      }
      if (result.issues === undefined) return { ok: true, value: result.value };
      return {
        ok: false,
        issues: result.issues.map((issue) => ({ path: pointer(issue.path), message: issue.message })),
      };
    },
  };
}

/**
 * Prepares a tool's input schema. Throws an `SdkError`, code `invalid_tool_definition`, when a raw schema does not
 * compile or names a draft other than 2020-12 or 7, or when a Standard Schema cannot produce JSON Schema.
 */
export function prepareSchema(tool: string, schema: ToolSchema<unknown>): PreparedSchema {
  if (!isSchemaShaped(schema)) throw invalid(tool, "inputSchema must be a JSON Schema object or a Standard Schema");
  return isStandardSchema(schema) ? prepareStandardSchema(tool, schema) : prepareJsonSchema(tool, schema);
}
