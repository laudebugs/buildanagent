import ts from "typescript-api";

/**
 * What the book makes of one inline-code span. An identifier-like span is checked: each name in it must resolve to a
 * listing, a transcript or a pinned `.d.ts` export, or the span must carry a hand-checked marker. A span that a skip
 * pattern matches is left alone and says which pattern matched, and so is any other span, such as an expression.
 */
export type InlineSpan =
  | { readonly kind: "checked"; readonly names: readonly string[] }
  | { readonly kind: "skipped"; readonly rule: SkipRule }
  | { readonly kind: "unchecked" };

/** The three patterns that skip the check, each tested: file paths, shell commands, and plain values or keywords. */
export type SkipRule = "path" | "command" | "value";

const NAME = String.raw`[$_\p{ID_Start}][$‌‍\p{ID_Continue}]*`;
/** A JavaScript identifier or a dotted member path such as `result.steps`, with an optional `()` after it. */
const IDENTIFIER_LIKE = new RegExp(String.raw`^${NAME}(?:\.${NAME})*(?:\(\))?$`, "u");

/** The extensions of the files a chapter names, so `package.json` and `index.ts` read as files, not member paths. */
export const FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  "cjs",
  "css",
  "cts",
  "html",
  "js",
  "json",
  "jsonc",
  "jsx",
  "md",
  "mdx",
  "mjs",
  "mts",
  "sh",
  "svg",
  "toml",
  "ts",
  "tsx",
  "txt",
  "yaml",
  "yml",
]);

/** The commands a chapter runs in a shell. A span that starts with one, such as `pnpm test`, is a command. */
export const SHELL_COMMANDS: ReadonlySet<string> = new Set([
  "corepack",
  "curl",
  "gh",
  "git",
  "node",
  "npm",
  "npx",
  "pnpm",
  "tsc",
  "tsx",
  "wrangler",
]);

/** Global values that are not TypeScript keywords, which the scanner already knows. */
const PLAIN_VALUES: ReadonlySet<string> = new Set(["Infinity", "NaN"]);

/** Whether a word is a TypeScript keyword, contextual ones such as `async` and `string` included, as its scanner reads it. */
const isKeyword = (word: string): boolean =>
  ts.identifierToKeywordKind(ts.factory.createIdentifier(word)) !== undefined;

/**
 * Sorts an inline-code span. The skip patterns run first: a command starts with a shell command's name; a path holds
 * a slash or ends in a file extension; a value is a number, a quoted string, a keyword or `NaN` and `Infinity`.
 * Otherwise a span that matches a JavaScript identifier or a dotted member path is checked, by each of its names that
 * is not a keyword, so `import.meta.resolve` is checked by `meta` and `resolve`.
 */
export function classifySpan(text: string): InlineSpan {
  const span = text.trim();
  const words = span.split(/\s+/);
  if (SHELL_COMMANDS.has(words[0] ?? "")) return { kind: "skipped", rule: "command" };
  if (/[/\\]/.test(span)) return { kind: "skipped", rule: "path" };
  if (/^[-+]?\.?\d/.test(span) || /^(["'`]).*\1$/s.test(span)) return { kind: "skipped", rule: "value" };
  if (!IDENTIFIER_LIKE.test(span)) return { kind: "unchecked" };
  const segments = span.replace(/\(\)$/, "").split(".");
  const last = segments.at(-1) ?? "";
  if (segments.length > 1 && FILE_EXTENSIONS.has(last.toLowerCase())) return { kind: "skipped", rule: "path" };
  const names = segments.filter((name) => !isKeyword(name) && !PLAIN_VALUES.has(name));
  if (names.length === 0) return { kind: "skipped", rule: "value" };
  return { kind: "checked", names };
}

/** The hand-checked marker written right after an inline-code span: `{checked=row-12}`. */
const MARKER = /^\{checked=row-([1-9]\d*)\}/;
/** Anything that starts like a marker, so a misspelt one fails instead of staying text. */
const MARKER_LIKE = /^\{\s*checked\b[^}]*\}?/;

/**
 * The hand-checked marker at the start of the text after an inline-code span: the fact-check row it cites and the
 * marker's length, a malformed marker's text, or undefined when the text does not start with one.
 */
export function markerAt(
  text: string,
): { readonly row: number; readonly length: number } | { readonly malformed: string } | undefined {
  const marker = MARKER.exec(text);
  if (marker) return { row: Number(marker[1]), length: marker[0].length };
  const like = MARKER_LIKE.exec(text);
  return like ? { malformed: like[0] } : undefined;
}
