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

/**
 * The words of `text` outside quotes joined by single spaces; quoted text is kept as written. A backslash outside
 * single quotes is kept with the character after it, so `foo\ bar` keeps its escaped space and `"a\"b"` stays one
 * quoted word: commands the shell would run differently never read, or group, as one.
 */
function normalised(text: string): string {
  let out = "";
  let quote: string | undefined;
  let space = false;
  // No trim: leading and trailing spaces are dropped by the loop, and an escaped trailing space is kept.
  for (let at = 0; at < text.length; ) {
    const token = tokenAt(text, at, quote);
    at += token.length;
    if (quote === undefined && /^\s$/.test(token)) {
      space = true;
      continue;
    }
    if (space && out !== "") out += " ";
    space = false;
    out += token;
    if (quote === undefined && (token === '"' || token === "'")) quote = token;
    else if (token === quote) quote = undefined;
  }
  return out;
}

/**
 * The text at `at` that stays together: a backslash outside single quotes with the character it escapes,
 * or one character.
 */
const tokenAt = (text: string, at: number, quote: string | undefined): string =>
  text[at] === "\\" && quote !== "'" ? text.slice(at, at + 2) : (text[at] as string);

/**
 * The operator that starts at `at` outside quotes, or `undefined`. `afterRedirect` says the character before is an
 * unescaped `<` or `>`, so the `&` of `2>&1` or `<&3` and the `|` of `>|` belong to a redirection, as does the `&` of
 * `&>` and `&>>`; none of them ends a command.
 */
function operatorAt(text: string, at: number, afterRedirect: boolean): string | undefined {
  const found = OPERATORS.find((operator) => text.startsWith(operator, at));
  if (found === "&" && (afterRedirect || text[at + 1] === ">")) return undefined;
  if (found === "|" && afterRedirect) return undefined;
  return found;
}

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
  // The index of the last character a backslash escaped, which is a plain character and never a redirection.
  let escaped = -1;
  for (let at = 0; at < command.length; at++) {
    const char = command[at] as string;
    if (char === "\\" && scan.quote !== "'") {
      at += 1;
      escaped = at;
      continue;
    }
    const afterRedirect = at > 0 && escaped !== at - 1 && (command[at - 1] === ">" || command[at - 1] === "<");
    const found = step(scan, char) ? operatorAt(command, at, afterRedirect) : undefined;
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
