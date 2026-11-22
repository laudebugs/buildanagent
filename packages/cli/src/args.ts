/**
 * Reads the command line into positional words and flags. Flags may come anywhere, as `--name value` or
 * `--name=value`, and `--` ends them, so a prompt that starts with a dash still reads as a prompt.
 */
import { CliError } from "./errors.js";

/** The flags every command shares. A flag a command doesn't use is ignored by it. */
export interface Flags {
  readonly json: boolean;
  readonly force: boolean;
  readonly help: boolean;
  readonly model?: string;
  readonly stateDir?: string;
  readonly otlpEndpoint?: string;
  readonly budgetUsd?: number;
}

/** The command line, read. */
export interface ParsedArgs {
  readonly positionals: readonly string[];
  readonly flags: Flags;
}

const BOOLEAN_FLAGS: Readonly<Record<string, "json" | "force" | "help">> = {
  "--json": "json",
  "--force": "force",
  "--help": "help",
  "-h": "help",
};

const VALUE_FLAGS: Readonly<Record<string, "model" | "stateDir" | "otlpEndpoint" | "budgetUsd">> = {
  "--model": "model",
  "--state-dir": "stateDir",
  "--otlp-endpoint": "otlpEndpoint",
  "--budget": "budgetUsd",
};

// Decimal digits only: `Number()` would also read `0x10`, `1e3` and ` 2 ` as amounts nobody meant to type.
const DECIMAL = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

function budgetOf(text: string): number {
  const value = Number(text);
  if (!DECIMAL.test(text) || !Number.isFinite(value) || value <= 0) {
    throw new CliError("usage", `--budget takes a positive number of US dollars, got ${JSON.stringify(text)}`);
  }
  return value;
}

type MutableFlags = { -readonly [K in keyof Flags]: Flags[K] };

/** Sets the flag `word` names, reading its value from `next` when it takes one. Returns how many words it used. */
function readFlag(flags: MutableFlags, word: string, next: string | undefined): number {
  const [name, inline] = word.startsWith("--") && word.includes("=") ? word.split(/=(.*)/s) : [word, undefined];
  const boolean = BOOLEAN_FLAGS[name as string];
  if (boolean !== undefined && inline === undefined) {
    flags[boolean] = true;
    return 1;
  }
  const valued = VALUE_FLAGS[name as string];
  if (valued === undefined) throw new CliError("usage", `unknown flag ${JSON.stringify(word)}`);
  const value = inline ?? next;
  // An empty value, as in `--state-dir=`, would otherwise fall back to a default the caller never asked for.
  if (value === undefined || value === "") throw new CliError("usage", `${name} needs a value`);
  // A flag or `--` after a value flag means its value was left out, as in `--model --json hi`; taking the next word
  // would swallow it. A value that starts with a dash is still possible written as `--name=value`.
  if (inline === undefined && value.startsWith("-")) {
    throw new CliError(
      "usage",
      `${name} needs a value, got ${JSON.stringify(value)}; write ${name}=<value> for a value that starts with -`,
    );
  }
  if (valued === "budgetUsd") flags.budgetUsd = budgetOf(value);
  else flags[valued] = value;
  return inline === undefined ? 2 : 1;
}

/**
 * Reads `argv`, the arguments after the program name. Throws a `CliError` with code `usage` for an unknown flag, or
 * for a missing or empty value, including one where the next word is another flag or `--`.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: MutableFlags = { json: false, force: false, help: false };
  let at = 0;
  while (at < argv.length) {
    const word = argv[at] as string;
    if (word === "--") {
      positionals.push(...argv.slice(at + 1));
      break;
    }
    if (word.startsWith("-") && word !== "-") at += readFlag(flags, word, argv[at + 1]);
    else {
      positionals.push(word);
      at += 1;
    }
  }
  return { positionals, flags };
}
