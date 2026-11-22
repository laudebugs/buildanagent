/**
 * Checks a command against the protocol schema before the dispatcher runs it. `protocol.schema.json` is a copy of the
 * protocol package's generated schema, which ships no JSON of its own; a test fails while the two differ. The schema is
 * one `anyOf` over every message, whose groups hold one branch per message kind. A command's branch is the one that
 * requires an `id` and whose `method` is a `const` or an `enum` naming client methods: each command method must have
 * exactly one, or building the index throws. Each branch is compiled with the schema's shared `$defs` the first time a
 * command of its method arrives, and kept.
 */
import { CLIENT_METHODS, type ClientCommand } from "@buildanagent/protocol";
import { compile, type JsonSchema, type Validator } from "@earendil-works/pi-schema";
import schema from "./protocol.schema.json" with { type: "json" };

/** A command method, as the client sends it with an `id`. */
type CommandMethod = ClientCommand["method"];

interface Branch {
  readonly required?: readonly string[];
  readonly properties?: { readonly method?: { readonly const?: unknown; readonly enum?: readonly unknown[] } };
  readonly anyOf?: readonly Branch[];
}

/** The longest field path an error names, because a client chooses the names of the fields it sends. */
const MAX_PATH = 120;

const clientMethods: ReadonlySet<string> = new Set(CLIENT_METHODS);
const root = schema as unknown as { readonly anyOf: readonly Branch[]; readonly $defs: Record<string, unknown> };

let branches: ReadonlyMap<string, Branch> | undefined;
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
  const validator = compile({ ...branch, $defs: root.$defs } as JsonSchema, { draft: "2020-12" });
  validators.set(method, validator);
  return validator;
}

/** The command methods the protocol schema has a branch for, so a test can check that none is missing. */
export function checkedMethods(): readonly string[] {
  branches ??= indexBranches();
  return [...branches.keys()];
}

/**
 * Why a command breaks its schema branch, or `undefined` when it fits or its method has no branch, which the
 * dispatcher answers with `MethodNotFound`. The reason names the first error's field path and keyword only, never a
 * value the client sent.
 */
export function paramsProblem(command: { readonly method: CommandMethod | string }): string | undefined {
  const { method } = command;
  const validator = validatorFor(method);
  if (validator === undefined || validator.check(command)) return undefined;
  const [first] = validator.errors(command);
  if (first === undefined) return `the params of ${method} do not match the protocol schema`;
  const path = first.path.length > MAX_PATH ? `${first.path.slice(0, MAX_PATH)}…` : first.path || "/";
  return `the params of ${method} do not match the protocol schema: ${path} fails ${first.keyword}`;
}
