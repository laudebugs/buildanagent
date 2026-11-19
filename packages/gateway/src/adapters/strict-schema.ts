/**
 * Lowers a tool's JSON Schema to the subset a provider's strict tool mode accepts, and undoes the one change the
 * model can see: the `null` that a nullable dialect adds to an optional property. Each adapter passes its own
 * `StrictDialect`; the rules both first providers share are these:
 *
 * - every object needs `additionalProperties: false`, and an object with any other `additionalProperties` cannot be
 *   strict. An object that declares neither `properties` nor `additionalProperties` accepts any keys, and adding
 *   `additionalProperties: false` would let the model send only `{}`, so it cannot be strict either;
 * - `not` is unsupported, and `oneOf` must be written as `anyOf`;
 * - numeric constraints, string length constraints and array constraints beyond `minItems` of 0 or 1 are dropped.
 *   Anthropic rejects them (Structured outputs, "JSON Schema limitations",
 *   https://platform.claude.com/docs/en/build-with-claude/structured-outputs, as of November 2026). OpenAI's list
 *   could not be read from its docs, so the OpenAI dialect drops the same keywords, which keeps it inside both.
 *
 * Anthropic keeps optional properties optional. OpenAI's strict mode makes the model "follow the exact schema"
 * (`FunctionDefinition.strict`, openai-node v7.49.0, `src/resources/shared.ts`, as of November 2026), so its
 * dialect writes an optional property as a required one that also accepts `null`. The removed constraints are not
 * lost: the SDK validates every call against the original schema, after `stripAddedNulls()`.
 */

type Json = Record<string, unknown>;

/** How one provider's strict mode differs from the shared rules above. */
export interface StrictDialect {
  /** `"keep"` leaves optional properties optional; `"nullable"` requires them and lets them be `null`. */
  readonly optional: "keep" | "nullable";
  /** The string formats the provider accepts; any other `format` is dropped. */
  readonly formats: ReadonlySet<string>;
  /** True when the provider accepts only an object schema, with `type: "object"`, at the root. */
  readonly objectRoot: boolean;
}

/** A schema lowered to strict form, with the counts the request-wide complexity limits are checked against. */
export interface StrictSchema {
  readonly schema: Json;
  /** Properties left out of `required`, across the whole schema. Always 0 for a nullable dialect. */
  readonly optional: number;
  /** Subschemas that use `anyOf` or a type array, the null unions a nullable dialect adds included. */
  readonly unions: number;
}

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
// Lookaround, named groups and backreferences fall outside the documented regex subset.
const UNSUPPORTED_PATTERN = /\(\?|\\[1-9k]/;
const SCHEMA_LISTS = ["anyOf", "allOf", "oneOf", "prefixItems"];
const SCHEMA_MAPS = ["properties", "$defs", "definitions"];

interface Walk {
  readonly dialect: StrictDialect;
  optional: number;
  unions: number;
  /** Set when the schema uses a feature strict mode rejects; the tool is then sent without `strict`. */
  failure?: string;
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for a key strict mode rejects, so lowering removes it. */
function dropsKey(key: string, value: unknown, dialect: StrictDialect): boolean {
  if (UNSUPPORTED_KEYWORDS.has(key)) return true;
  if (key === "minItems") return typeof value !== "number" || value > 1;
  if (key === "format") return typeof value !== "string" || !dialect.formats.has(value);
  return key === "pattern" && (typeof value !== "string" || UNSUPPORTED_PATTERN.test(value));
}

function lowerChildren(key: string, value: unknown, walk: Walk): unknown {
  if (SCHEMA_LISTS.includes(key) && Array.isArray(value)) return value.map((item) => lowerNode(item, walk));
  if (SCHEMA_MAPS.includes(key) && isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, lowerNode(item, walk)]));
  }
  if (key === "items" && isObject(value)) return lowerNode(value, walk);
  return value;
}

/**
 * True when the schema already accepts `null`. A schema that constrains nothing, such as `{}`, accepts it; a `$ref`
 * or an `allOf` counts as not accepting it, so a nullable dialect gives it an explicit `null` branch.
 */
function allowsNull(schema: unknown): boolean {
  if (!isObject(schema)) return true;
  if (schema.type === "null" || (Array.isArray(schema.type) && schema.type.includes("null"))) return true;
  if (Array.isArray(schema.enum)) return schema.enum.includes(null);
  if ("const" in schema) return schema.const === null;
  const branches = Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : undefined;
  if (branches) return branches.some(allowsNull);
  return schema.type === undefined && !("$ref" in schema) && !("allOf" in schema);
}

/** The schema made to accept `null` as well, in the simplest form strict mode reads. */
function withNull(schema: Json, walk: Walk): Json {
  if (allowsNull(schema)) return schema;
  walk.unions += 1;
  if (typeof schema.type === "string" && !Array.isArray(schema.enum) && !("const" in schema)) {
    return { ...schema, type: [schema.type, "null"] };
  }
  if (Array.isArray(schema.anyOf)) return { ...schema, anyOf: [...schema.anyOf, { type: "null" }] };
  return { anyOf: [schema, { type: "null" }] };
}

/** Marks every property required, and lets each one that was optional be `null`. */
function requireAll(lowered: Json, original: Json, walk: Walk): void {
  if (!isObject(lowered.properties)) return;
  const required = new Set(Array.isArray(original.required) ? original.required : []);
  const properties = lowered.properties;
  for (const [name, property] of Object.entries(properties)) {
    if (!required.has(name) && isObject(property)) properties[name] = withNull(property, walk);
  }
  lowered.required = Object.keys(properties);
}

function countOptional(node: Json, walk: Walk): void {
  const properties = isObject(node.properties) ? Object.keys(node.properties) : [];
  const required = new Set(Array.isArray(node.required) ? node.required : []);
  walk.optional += properties.filter((name) => !required.has(name)).length;
}

/** Why strict mode cannot express this node itself, or `undefined` when it can. */
function strictFailure(node: Json, isObjectSchema: boolean): string | undefined {
  if ("not" in node) return "uses not";
  if (!isObjectSchema) return undefined;
  if ("additionalProperties" in node) {
    return node.additionalProperties === false ? undefined : "allows additional properties";
  }
  return isObject(node.properties) ? undefined : "declares no properties";
}

// A nullable object, `type: ["object", "null"]`, is an object too and needs the same treatment.
function isObjectNode(node: Json): boolean {
  return (
    node.type === "object" || (Array.isArray(node.type) && node.type.includes("object")) || isObject(node.properties)
  );
}

function lowerNode(node: unknown, walk: Walk): unknown {
  if (!isObject(node) || walk.failure !== undefined) return node;
  const isObjectSchema = isObjectNode(node);
  const failure = strictFailure(node, isObjectSchema);
  if (failure !== undefined) {
    walk.failure = failure;
    return node;
  }
  const lowered: Json = {};
  for (const [key, value] of Object.entries(node)) {
    if (dropsKey(key, value, walk.dialect)) continue;
    lowered[key === "oneOf" ? "anyOf" : key] = lowerChildren(key, value, walk);
  }
  if (isObjectSchema) {
    lowered.additionalProperties = false;
    if (walk.dialect.optional === "nullable") requireAll(lowered, node, walk);
    else countOptional(node, walk);
  }
  if (Array.isArray(node.type) || Array.isArray(lowered.anyOf)) walk.unions += 1;
  return lowered;
}

/** The schema in strict form with its counts, or `undefined` when strict mode cannot express it. */
export function lowerToStrict(schema: Json, dialect: StrictDialect): StrictSchema | undefined {
  if (dialect.objectRoot && schema.type !== "object") return undefined;
  const walk: Walk = { dialect, optional: 0, unions: 0 };
  const lowered = lowerNode(schema, walk) as Json;
  return walk.failure === undefined ? { schema: lowered, optional: walk.optional, unions: walk.unions } : undefined;
}

// Stripping the added nulls ------------------------------------------------------------------------------------------

/** Follows a local `#/$defs/…` or `#/definitions/…` reference; any other schema comes back as it is. */
function resolve(schema: unknown, root: Json): unknown {
  if (!isObject(schema) || typeof schema.$ref !== "string") return schema;
  const match = /^#\/(\$defs|definitions)\/([^/]+)$/.exec(schema.$ref);
  if (match === null) return schema;
  const defs = root[match[1] ?? ""];
  return isObject(defs) ? defs[decodeURIComponent(match[2] ?? "")] : schema;
}

function strip(value: unknown, node: unknown, root: Json): unknown {
  const schema = resolve(node, root);
  if (!isObject(schema)) return value;
  if (Array.isArray(value))
    return isObject(schema.items) ? value.map((item) => strip(item, schema.items, root)) : value;
  if (!isObject(value) || !isObject(schema.properties)) return value;
  const properties = schema.properties;
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const out: Json = {};
  for (const [name, item] of Object.entries(value)) {
    const property = properties[name];
    // A null the original schema does not allow here is one lowering added, and leaving the field out is what the
    // model meant by it.
    if (item === null && property !== undefined && !required.has(name) && !allowsNull(resolve(property, root)))
      continue;
    out[name] = property === undefined ? item : strip(item, property, root);
  }
  return out;
}

/**
 * Removes from a tool call's input each `null` that nullable lowering added: a `null` in a property that the original
 * schema leaves optional and does not let be `null`. It follows `properties`, `items` and local `$ref`s. Inside an
 * `anyOf` it cannot tell which branch the model chose, so it leaves those values as they are.
 */
export function stripAddedNulls(input: unknown, original: Json): unknown {
  return strip(input, original, original);
}
