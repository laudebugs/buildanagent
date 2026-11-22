import { type BundledLanguage, bundledLanguages, createCssVariablesTheme, createHighlighter } from "shiki";
import type { ListingSource } from "../book/listings.js";
import type { SourceLine } from "../book/regions.js";
import type { CodeToken, ListingLine } from "../components/types.js";

// Shiki's CSS-variables theme colours each token with a variable named for its syntax kind, such as
// var(--shiki-token-keyword), instead of a colour. The book reads that name back as one of the panel's token kinds,
// so a listing takes its colours from the design tokens like every other panel, and no colour reaches the page from
// Shiki.
const theme = createCssVariablesTheme({ name: "book-listing", variablePrefix: "--shiki-" });

const KINDS: Readonly<Record<string, CodeToken["kind"]>> = {
  "var(--shiki-token-keyword)": "keyword",
  "var(--shiki-token-string)": "string",
  "var(--shiki-token-string-expression)": "string",
  "var(--shiki-token-comment)": "comment",
};

let highlighter: ReturnType<typeof createHighlighter> | undefined;

/** The listing's lines as the book's components take them: each with its file line number and its tokens. */
export async function highlightListing(source: ListingSource): Promise<ListingLine[]> {
  return highlightLines(source.lines, source.lang);
}

/**
 * The lines of a listing written in the chapter, numbered from 1. A language Shiki does not bundle, or none, shows as
 * plain text, so a listing's lines are built the same way whatever its language.
 */
export async function highlightInline(code: string, lang: string | null | undefined): Promise<ListingLine[]> {
  const lines = code.split("\n").map((text, index) => ({ number: index + 1, text }));
  return highlightLines(
    lines,
    lang !== null && lang !== undefined && lang in bundledLanguages ? (lang as BundledLanguage) : "text",
  );
}

async function highlightLines(lines: readonly SourceLine[], lang: BundledLanguage | "text"): Promise<ListingLine[]> {
  highlighter ??= createHighlighter({ themes: [theme], langs: ["typescript", "tsx"] });
  const ready = await highlighter;
  if (lang !== "text" && !ready.getLoadedLanguages().includes(lang)) await ready.loadLanguage(lang);
  const { tokens } = ready.codeToTokens(lines.map((line) => line.text).join("\n"), { lang, theme });
  return lines.map((line, index) => ({
    number: line.number,
    tokens: merge((tokens[index] ?? []).map((token) => ({ text: token.content, kind: KINDS[token.color ?? ""] }))),
    ...(line.note === undefined ? {} : { note: line.note }),
  }));
}

/** Joins neighbouring tokens of one kind, so a line holds as few spans as its colours need. */
function merge(tokens: readonly { text: string; kind: CodeToken["kind"] }[]): CodeToken[] {
  const out: CodeToken[] = [];
  for (const token of tokens) {
    const previous = out.at(-1);
    if (previous !== undefined && previous.kind === token.kind) {
      out[out.length - 1] = { ...previous, text: previous.text + token.text };
    } else {
      out.push(token.kind === undefined ? { text: token.text } : { text: token.text, kind: token.kind });
    }
  }
  return out;
}
