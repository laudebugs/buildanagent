import type ts from "typescript-api";
import { typescript } from "./typescript.js";

/**
 * What the book makes of one inline-code span. A span of code is checked: each name in it must resolve to a listing,
 * a transcript or a pinned `.d.ts` export, or the span must carry a hand-checked marker. A span that a skip pattern
 * matches is left alone and says which pattern matched; so is a span that is not code, such as the notation `pass^k`.
 */
export type InlineSpan =
  | { readonly kind: "checked"; readonly names: readonly string[] }
  | { readonly kind: "skipped"; readonly rule: SkipRule }
  | { readonly kind: "unchecked" };

/** The three patterns that skip the check, each tested: shell commands, file paths and literal values. */
export type SkipRule = "command" | "path" | "value";

const NAME = String.raw`[$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*`;
/** A JavaScript identifier or a dotted member path such as `result.steps`, with an optional `()` after it. */
const IDENTIFIER_LIKE = new RegExp(String.raw`^${NAME}(?:\.${NAME})*(?:\(\))?$`, "u");
/** A path with a slash or a backslash, and no space, bracket or quote, such as `src/index.ts` or `C:\agent\run.ts`. */
const PATH = /^[\w.@~$:*-]*[\\/][\w.@~$:*\\/-]*$/;

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

/**
 * The commands a chapter runs in a shell: the workspace's own toolchain. A span that starts with one, such as
 * `pnpm test`, is a command. Add a command when a chapter first needs it, and the test with it.
 */
export const SHELL_COMMANDS: ReadonlySet<string> = new Set(["git", "node", "npm", "npx", "pnpm", "tsc", "tsx"]);

/** The literal values a span may be on its own, beside numbers and quoted strings. */
export const LITERAL_VALUES: ReadonlySet<string> = new Set(["Infinity", "NaN", "false", "null", "true", "undefined"]);

/**
 * Whether a word is reserved and so can never be an identifier: an ECMAScript reserved word, a strict-mode one, or
 * `await`, which module code reserves and every listing is. Contextual keywords such as `type`, `async` and `string`
 * are identifiers in some places, so they are checked like any name.
 */
function isReserved(word: string): boolean {
  const ts = typescript();
  const kind = ts.identifierToKeywordKind(ts.factory.createIdentifier(word));
  if (kind === undefined) return false;
  const { FirstReservedWord, LastReservedWord, FirstFutureReservedWord, LastFutureReservedWord } = ts.SyntaxKind;
  return (
    (kind >= FirstReservedWord && kind <= LastReservedWord) ||
    (kind >= FirstFutureReservedWord && kind <= LastFutureReservedWord) ||
    kind === ts.SyntaxKind.AwaitKeyword
  );
}

/**
 * The names of an identifier or a member path: every segment, except a reserved word before the first dot, as in
 * `this.state` or `import.meta`. A name after a dot is a property, whatever it spells, so `part.type` and
 * `result.object` are checked by both their names.
 */
function pathNames(span: string): readonly string[] | undefined {
  const segments = span.replace(/\(\)$/, "").split(".");
  const [first = "", ...rest] = segments;
  if (!isReserved(first)) return segments;
  return rest.length === 0 ? undefined : rest;
}

/** Expressions that make a span code, not notation: a call, `new`, a member access, an object or a function. */
function codeKinds(): ReadonlySet<ts.SyntaxKind> {
  const { SyntaxKind } = typescript();
  return new Set([
    SyntaxKind.CallExpression,
    SyntaxKind.NewExpression,
    SyntaxKind.PropertyAccessExpression,
    SyntaxKind.ElementAccessExpression,
    SyntaxKind.ObjectLiteralExpression,
    SyntaxKind.ArrowFunction,
    SyntaxKind.FunctionExpression,
    SyntaxKind.TaggedTemplateExpression,
  ]);
}

const parsed = new Map<string, readonly string[] | undefined>();

/**
 * The names a span of code holds, read with the compiler: every identifier in it, property names and labels
 * included, but no string, number or literal value. Undefined when the span does not parse as TypeScript, or when it
 * is a lone expression of operators and plain names, such as `pass^k` or `n - 1`, which reads as notation.
 * Spans repeat across a book, so each text is parsed once per process.
 */
function codeNames(span: string): readonly string[] | undefined {
  if (parsed.has(span)) return parsed.get(span);
  const ts = typescript();
  const kinds = codeKinds();
  const { diagnostics = [] } = ts.transpileModule(span, {
    fileName: "span.ts",
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, noLib: true },
  });
  let names: string[] | undefined;
  if (diagnostics.length === 0) {
    const file = ts.createSourceFile("span.ts", span, ts.ScriptTarget.ESNext, true);
    const found: string[] = [];
    let code = !(file.statements.length === 1 && ts.isExpressionStatement(file.statements[0] as ts.Statement));
    const visit = (node: ts.Node): void => {
      if (kinds.has(node.kind)) code = true;
      if (ts.isIdentifier(node) && !LITERAL_VALUES.has(node.text)) found.push(node.text);
      ts.forEachChild(node, visit);
    };
    visit(file);
    names = code && found.length > 0 ? [...new Set(found)] : undefined;
  }
  parsed.set(span, names);
  return names;
}

/**
 * Sorts an inline-code span. The skip patterns run first: a command starts with a shell command's name; a path holds
 * a slash, or is a dotted name that ends in a file extension and has no `()`; a value is a number, a quoted string or
 * a literal such as `true` or `undefined`. An identifier or a member path is then checked by its names, a reserved
 * word alone is not code, and any other span is checked by the names in it when it parses as code.
 */
export function classifySpan(text: string): InlineSpan {
  const span = text.trim();
  if (SHELL_COMMANDS.has(span.split(/\s+/)[0] ?? "")) return { kind: "skipped", rule: "command" };
  if (PATH.test(span)) return { kind: "skipped", rule: "path" };
  if (/^[-+]?\.?\d[\w.]*$/.test(span) || /^(["'`]).*\1$/s.test(span) || LITERAL_VALUES.has(span)) {
    return { kind: "skipped", rule: "value" };
  }
  if (IDENTIFIER_LIKE.test(span)) {
    const extension = span.split(".").at(-1)?.toLowerCase() ?? "";
    if (span.includes(".") && !span.endsWith("()") && FILE_EXTENSIONS.has(extension)) {
      return { kind: "skipped", rule: "path" };
    }
    const names = pathNames(span);
    return names === undefined ? { kind: "unchecked" } : { kind: "checked", names };
  }
  const names = codeNames(span);
  return names === undefined ? { kind: "unchecked" } : { kind: "checked", names };
}

/** The hand-checked marker written right after an inline-code span: `{checked=row-12}`. */
const MARKER = /^\{checked=row-([1-9]\d*)\}/;
/** Anything that starts like a marker, so a misspelt one fails instead of staying text. */
const MARKER_LIKE = /^\{\s*checked\b[^}]*\}?/;
/** A marker anywhere in a text, which is stray unless it touches the code span before it. */
export const STRAY_MARKER = /\{\s*checked\b[^}]*\}?/;

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
