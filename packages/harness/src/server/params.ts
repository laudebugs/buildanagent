/**
 * Checks a command against the protocol schema before the dispatcher runs it. `protocol.schema.json` is a copy of the
 * protocol package's generated schema, which ships no JSON of its own; a test fails while the two differ. The schema is
 * one `anyOf` over every message, whose groups hold one branch per message kind. A command's branch is the one that
 * requires an `id` and whose `method` is a `const` or an `enum` naming client methods: each command method must have
 * exactly one, or building the index throws. Only the branch's `params` schema is checked, compiled with the schema's
 * shared `$defs` the first time a command of its method arrives, and kept: `decode()` has already checked the envelope.
 */
import { CLIENT_METHODS, type ClientCommand } from "@buildanagent/protocol";
import { compile, type JsonSchema, type Validator } from "@earendil-works/pi-schema";
import schema from "./protocol.schema.json" with { type: "json" };

/** A command method, as the client sends it with an `id`. */
type CommandMethod = ClientCommand["method"];

interface Branch {
  readonly required?: readonly string[];
  readonly properties?: {
    readonly method?: { readonly const?: unknown; readonly enum?: readonly unknown[] };
    readonly params?: Record<string, unknown>;
  };
  readonly anyOf?: readonly Branch[];
}

/**
 * The keywords whose error path ends in a key the client chose, not one the schema declares. Their answer names the
 * object that holds the key instead.
 */
const KEY_KEYWORDS: ReadonlySet<string> = new Set(["additionalProperties", "propertyNames", "unevaluatedProperties"]);

const clientMethods: ReadonlySet<string> = new Set(CLIENT_METHODS);
const root = schema as unknown as { readonly anyOf: readonly Branch[]; readonly $defs: Record<string, unknown> };

let branches: ReadonlyMap<string, Branch> | undefined;
let declared: ReadonlySet<string> | undefined;
const validators = new Map<string, Validator<unknown>>();

const methodsOf = (branch: Branch): readonly unknown[] => {
  const method = branch.properties?.method;
  if (method === undefined) return [];
  if (method.const !== undefined) return [method.const];
  return method.enum ?? [];
};

/** Maps each command method to its branch, reading the top-level `anyOf` and the groups one level down. */
function indexBranches(): ReadonlyMap<string, Branch> {
  const index = new Map<string, Branch>();
  for (const branch of root.anyOf.flatMap((group) => group.anyOf ?? [group])) {
    if (!branch.required?.includes("id")) continue;
    for (const method of methodsOf(branch)) {
      if (typeof method !== "string" || !clientMethods.has(method)) continue;
      if (index.has(method)) throw new Error(`the protocol schema has two branches for the command ${method}`);
      index.set(method, branch);
    }
  }
  return index;
}

function validatorFor(method: string): Validator<unknown> | undefined {
  const cached = validators.get(method);
  if (cached !== undefined) return cached;
  branches ??= indexBranches();
  const branch = branches.get(method);
  if (branch === undefined) return undefined;
  // A branch without a params schema takes any params, as an empty schema does.
  const validator = compile({ ...branch.properties?.params, $defs: root.$defs } as JsonSchema, { draft: "2020-12" });
  validators.set(method, validator);
  return validator;
}

/** The command methods the protocol schema has a branch for, so a test can check that none is missing. */
export function checkedMethods(): readonly string[] {
  branches ??= indexBranches();
  return [...branches.keys()];
}

/** Every property name the schema declares anywhere, the only words an error path may carry. */
function declaredNames(): ReadonlySet<string> {
  const names = new Set<string>();
  // The replacer visits every member of the schema, however deep, which is all the walk needs.
  JSON.stringify(schema, (key, value: unknown) => {
    if (key === "properties" && typeof value === "object" && value !== null && !Array.isArray(value)) {
      for (const name of Object.keys(value)) names.add(name);
    }
    return value;
  });
  return names;
}

/**
 * The part of an error's path that names only what the schema declares: array indices and declared property names. A
 * key the client chose, and everything below it, is left out, so the answer never echoes it.
 */
function safePath(path: string, keyword: string): string {
  declared ??= declaredNames();
  const segments = path.split("/").slice(1);
  if (KEY_KEYWORDS.has(keyword)) segments.pop();
  const kept: string[] = [];
  for (const segment of segments) {
    if (!/^(0|[1-9][0-9]{0,8})$/.test(segment) && !declared.has(segment)) break;
    kept.push(segment);
  }
  return ["/params", ...kept].join("/");
}

/**
 * Why a command's params break its schema branch, or `undefined` when they fit or its method has no branch, which the
 * dispatcher answers with `MethodNotFound`. JSON-RPC lets a command leave out `params`, which is checked as `{}`, so a
 * method whose params are all optional takes it and one with a required field refuses it. The reason names the first
 * error's keyword and the path to it, cut at the first key the schema does not declare, never a key or a value the
 * client sent.
 */
export function paramsProblem(command: {
  readonly method: CommandMethod | string;
  readonly params?: unknown;
}): string | undefined {
  const { method } = command;
  const validator = validatorFor(method);
  const params = command.params === undefined ? {} : command.params;
  if (validator === undefined || validator.check(params)) return undefined;
  const [first] = validator.errors(params);
  if (first === undefined) return `the params of ${method} do not match the protocol schema`;
  return `the params of ${method} do not match the protocol schema: ${safePath(first.path, first.keyword)} fails ${first.keyword}`;
}
