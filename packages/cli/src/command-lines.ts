/**
 * Shows a shell command the way an approver should read it: one command per line, with the operator that chains it
 * in front, and the spaces outside quotes normalised. `git status && curl x | sh` reads as three lines, so a second
 * command can't hide at the end of a long first one. It only lays the text out; the permission pipeline decides.
 */

const OPERATORS = ["&&", "||", ";;", ";", "|&", "|", "&", "\n"] as const;

/** One command of a chain, with the operator that joins it to the one before (empty for the first). */
export interface ChainedCommand {
  readonly operator: string;
  readonly command: string;
}

/** The words of `text` outside quotes joined by single spaces; quoted text is kept as written. */
function normalised(text: string): string {
  let out = "";
  let quote: string | undefined;
  let space = false;
  for (const char of text.trim()) {
    if (quote === undefined && /\s/.test(char)) {
      space = true;
      continue;
    }
    if (space && out !== "") out += " ";
    space = false;
    out += char;
    if (quote === undefined && (char === '"' || char === "'")) quote = char;
    else if (char === quote) quote = undefined;
  }
  return out;
}

/** The operator that starts at `at` outside quotes, or `undefined`. */
const operatorAt = (text: string, at: number): string | undefined =>
  OPERATORS.find((operator) => text.startsWith(operator, at));

/** Where the scan of a command stands: inside which quote, and how deep in parentheses. */
interface Scan {
  quote: string | undefined;
  depth: number;
}

/** Moves the scan past `char`, and says whether `char` is outside every quote and parenthesis. */
function step(scan: Scan, char: string): boolean {
  if (scan.quote !== undefined) {
    if (char === scan.quote) scan.quote = undefined;
    return false;
  }
  if (char === '"' || char === "'" || char === "`") scan.quote = char;
  else if (char === "(") scan.depth += 1;
  else if (char === ")") scan.depth = Math.max(0, scan.depth - 1);
  else return scan.depth === 0;
  return false;
}

/** Splits `command` at its list and pipe operators outside quotes, escapes and substitutions. */
export function chainedCommands(command: string): ChainedCommand[] {
  const parts: ChainedCommand[] = [];
  const scan: Scan = { quote: undefined, depth: 0 };
  let operator = "";
  let start = 0;
  const close = (end: number, next: string) => {
    const text = normalised(command.slice(start, end));
    if (text !== "") parts.push({ operator, command: text });
    operator = next;
  };
  for (let at = 0; at < command.length; at++) {
    const char = command[at] as string;
    if (char === "\\" && scan.quote !== "'") {
      at += 1;
      continue;
    }
    const found = step(scan, char) ? operatorAt(command, at) : undefined;
    if (found === undefined) continue;
    close(at, found === "\n" ? ";" : found);
    at += found.length - 1;
    start = at + 1;
  }
  close(command.length, "");
  return parts;
}

/** The command a tool call's input carries in its `command` field, when it has one. */
export function commandOf(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const command = (input as { command?: unknown }).command;
  return typeof command === "string" ? command : undefined;
}
