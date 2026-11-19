/**
 * Lowers a tool's JSON Schema to the subset Anthropic's strict tool use accepts (Structured outputs, "JSON Schema
 * limitations" and "Schema complexity limits",
 * https://platform.claude.com/docs/en/build-with-claude/structured-outputs, as of November 2026):
 *
 * - every object needs `additionalProperties: false`, and an object with any other `additionalProperties` cannot be
 *   strict;
 * - `not` is unsupported, and `oneOf` must be written as `anyOf`;
 * - numeric constraints, string length constraints and array constraints beyond `minItems` of 0 or 1 are unsupported.
 *
 * Optional properties stay optional. Anthropic accepts them, and the same page counts a nullable union as costlier
 * than an optional property, so lowering adds no `null` and there is no added `null` to strip from a call's input.
 * The removed constraints are not lost: the SDK validates every call against the original schema.
 */

type Json = Record<string, unknown>;

/** A schema lowered to strict form, with the counts the request-wide complexity limits are checked against. */
export interface StrictSchema {
  readonly schema: Json;
  /** Properties not listed in `required`, across the whole schema. */
  readonly optional: number;
  /** Subschemas that use `anyOf` or a type array. */
  readonly unions: number;
}

/** The request-wide limits on strict schemas: strict tools, optional properties and union-typed parameters. */
export const STRICT_LIMITS = { tools: 20, optional: 24, unions: 16 } as const;

const UNSUPPORTED_KEYWORDS = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "patternProperties",
  "propertyNames",
]);
const SUPPORTED_FORMATS = new Set([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "uri",
  "ipv4",
  "ipv6",
  "uuid",
]);
// Lookaround, named groups and backreferences fall outside the documented regex subset.
const UNSUPPORTED_PATTERN = /\(\?|\\[1-9k]/;
const SCHEMA_LISTS = ["anyOf", "allOf", "oneOf", "prefixItems"];
const SCHEMA_MAPS = ["properties", "$defs", "definitions"];

interface Counts {
  optional: number;
  unions: number;
  /** Set when the schema uses a feature strict mode rejects; the tool is then sent without `strict`. */
  failure?: string;
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for a key strict mode rejects, so lowering removes it. */
function dropsKey(key: string, value: unknown): boolean {
  if (UNSUPPORTED_KEYWORDS.has(key)) return true;
  if (key === "minItems") return typeof value !== "number" || value > 1;
  if (key === "format") return typeof value !== "string" || !SUPPORTED_FORMATS.has(value);
  return key === "pattern" && (typeof value !== "string" || UNSUPPORTED_PATTERN.test(value));
}

function lowerChildren(key: string, value: unknown, counts: Counts): unknown {
  if (SCHEMA_LISTS.includes(key) && Array.isArray(value)) return value.map((item) => lowerNode(item, counts));
  if (SCHEMA_MAPS.includes(key) && isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, lowerNode(item, counts)]));
  }
  if (key === "items" && isObject(value)) return lowerNode(value, counts);
  return value;
}

function countObject(node: Json, counts: Counts): void {
  const properties = isObject(node.properties) ? Object.keys(node.properties) : [];
  const required = new Set(Array.isArray(node.required) ? node.required : []);
  counts.optional += properties.filter((name) => !required.has(name)).length;
}

function lowerNode(node: unknown, counts: Counts): unknown {
  if (!isObject(node) || counts.failure !== undefined) return node;
  const isObjectSchema = node.type === "object" || isObject(node.properties);
  if ("not" in node) counts.failure = "uses not";
  else if (isObjectSchema && "additionalProperties" in node && node.additionalProperties !== false) {
    counts.failure = "allows additional properties";
  }
  if (counts.failure !== undefined) return node;
  const lowered: Json = {};
  for (const [key, value] of Object.entries(node)) {
    if (dropsKey(key, value)) continue;
    lowered[key === "oneOf" ? "anyOf" : key] = lowerChildren(key, value, counts);
  }
  if (isObjectSchema) {
    lowered.additionalProperties = false;
    countObject(node, counts);
  }
  if (Array.isArray(node.type) || Array.isArray(lowered.anyOf)) counts.unions += 1;
  return lowered;
}

/** The schema in strict form with its counts, or `undefined` when strict mode cannot express it. */
export function lowerToStrict(schema: Json): StrictSchema | undefined {
  const counts: Counts = { optional: 0, unions: 0 };
  const lowered = lowerNode(schema, counts) as Json;
  return counts.failure === undefined
    ? { schema: lowered, optional: counts.optional, unions: counts.unions }
    : undefined;
}
