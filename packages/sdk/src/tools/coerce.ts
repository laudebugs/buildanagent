/**
 * Coercion: the few conversions the pipeline makes to a model's tool arguments before validation (D7 keeps coercion
 * our own step, not the validator's). The rules stay minimal and the SDK README lists them:
 *
 * 1. A string that holds JSON becomes the object or array it encodes, where the schema's `type` is `object` or
 *    `array`.
 * 2. A string that holds a decimal number becomes that number, where the `type` is `number`, or `integer` when the
 *    number is whole.
 * 3. The string `"true"` or `"false"` becomes a boolean, where the `type` is `boolean`.
 *
 * The rules reach nested values through `properties` and `items` only, and only where `type` is a single string.
 * They never change a value that already has the schema's type, and they never modify the input.
 */

type Schema = Readonly<Record<string, unknown>>;

const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Not JSON: the value stays a string, and validation reports it.
    return undefined;
  }
}

function coerceObject(value: unknown, schema: Schema): unknown {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  const object = isRecord(parsed) ? parsed : undefined;
  if (object === undefined) return value;
  const properties = isRecord(schema.properties) ? schema.properties : {};
  let copy: Record<string, unknown> | undefined;
  for (const [key, child] of Object.entries(properties)) {
    if (!Object.hasOwn(object, key)) continue;
    const coerced = coerceValue(object[key], child);
    if (coerced === object[key]) continue;
    copy ??= { ...object };
    copy[key] = coerced;
  }
  return copy ?? object;
}

function coerceArray(value: unknown, schema: Schema): unknown {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  if (!Array.isArray(parsed)) return value;
  if (!isRecord(schema.items)) return parsed;
  const items = schema.items;
  const coerced = parsed.map((item: unknown) => coerceValue(item, items));
  return coerced.some((item, index) => item !== parsed[index]) ? coerced : parsed;
}

function coerceNumber(value: unknown, integer: boolean): unknown {
  if (typeof value !== "string" || !DECIMAL.test(value)) return value;
  const number = Number(value);
  if (!Number.isFinite(number) || (integer && !Number.isInteger(number))) return value;
  return number;
}

function coerceBoolean(value: unknown): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

/** Applies the coercion rules to `value` under `schema`, returning `value` itself when no rule applies. */
export function coerceValue(value: unknown, schema: unknown): unknown {
  if (!isRecord(schema) || typeof schema.type !== "string") return value;
  switch (schema.type) {
    case "object":
      return coerceObject(value, schema);
    case "array":
      return coerceArray(value, schema);
    case "number":
      return coerceNumber(value, false);
    case "integer":
      return coerceNumber(value, true);
    case "boolean":
      return coerceBoolean(value);
    default:
      return value;
  }
}
