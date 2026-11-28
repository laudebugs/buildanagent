/**
 * A small HTML tokenizer for the content security policy checks. It reads a page the way a browser's tokenizer splits
 * it into tags, so markup inside an attribute value, a comment or a script's text is never mistaken for a tag.
 * Expressive Code, for example, puts raw code such as `Array<Script>` in a `data-code` attribute.
 *
 * It follows the WHATWG tokenizer for what the checks need: tag names, attributes with quoted and unquoted values,
 * comments, bogus comments, raw-text and escapable raw-text elements, and CDATA inside `<svg>` or `<math>`. It does not
 * build a tree. Character references are decoded only where a check needs them (see `decodeReferences`).
 */

/** A start tag as the tokenizer read it. Attribute names are lower-case; the first of a repeated name wins. */
export interface StartTag {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
  /** The offset of the tag's `<` in the text the tokenizer read. */
  readonly offset: number;
  /** The offset just past the tag's own `>`, where its content starts; a `>` inside a quoted value does not end it. */
  readonly end: number;
  /** True inside `<svg>` or `<math>`, where a browser parses the content as foreign content. */
  readonly foreign: boolean;
  /** The raw text of a raw-text element (`script`, `style` and the others), up to its end tag; otherwise undefined. */
  readonly text?: string;
  /** For a raw-text element, whether its end tag was found before the end of the document. */
  readonly closed?: boolean;
}

/** What one pass over a document finds. */
export interface Tokens {
  readonly tags: readonly StartTag[];
  /** Spans whose `<` characters are not markup: attribute values, comments and raw text, as `[start, end)` offsets. */
  readonly opaque: readonly (readonly [number, number])[];
}

const SPACE = new Set(["\t", "\n", "\f", "\r", " "]);
/**
 * Elements whose content is text up to the matching end tag. `noscript` is raw text because browsers run scripts, so
 * its content is invisible to the checks; `policy.ts` refuses a page that has one.
 */
const RAW_TEXT = new Set(["script", "style", "xmp", "iframe", "noembed", "noframes", "noscript", "textarea", "title"]);
const FOREIGN_ROOTS = new Set(["svg", "math"]);

const isAlpha = (char: string | undefined) => char !== undefined && /[A-Za-z]/.test(char);

/**
 * Lower-cases ASCII letters only, as an HTML tokenizer does for tag and attribute names. Unlike `toLowerCase()`, it
 * keeps every character's length, so an offset found in the result is an offset in the original: "İ" (U+0130)
 * lower-cases to two UTF-16 units and would shift every later index.
 */
export function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
}

/** Finds the end tag `</name` followed by a space, `/` or `>` in `lower`, the lower-cased text, from `from`; -1 when absent. */
function findEndTag(lower: string, name: string, from: number): number {
  const text = lower;
  for (let at = lower.indexOf(`</${name}`, from); at !== -1; at = lower.indexOf(`</${name}`, at + 1)) {
    const next = text[at + 2 + name.length];
    if (next === undefined || next === "/" || next === ">" || SPACE.has(next)) return at;
  }
  return -1;
}

/** Reads the attributes after a tag name, from `at`, and returns them with the offset just past the tag's `>`. */
function readAttributes(
  text: string,
  from: number,
  opaque: [number, number][],
): { attributes: Map<string, string>; end: number; selfClosing: boolean } {
  const attributes = new Map<string, string>();
  let at = from;
  for (;;) {
    // A tag closes itself only when a `/` outside any value comes right before its `>`. In `<svg a=b/>` the `/`
    // belongs to the unquoted value, so that tag does not.
    let slash = false;
    while (at < text.length && (SPACE.has(text[at] ?? "") || text[at] === "/")) {
      slash = text[at] === "/";
      at++;
    }
    if (at >= text.length) return { attributes, end: at, selfClosing: false };
    if (text[at] === ">") return { attributes, end: at + 1, selfClosing: slash };
    // An attribute name runs to a space, `/`, `>` or `=`; an `=` in its first place belongs to the name.
    const nameStart = at;
    at++;
    while (at < text.length && !SPACE.has(text[at] ?? "") && !"/>=".includes(text[at] ?? "")) at++;
    const name = asciiLower(text.slice(nameStart, at));
    while (at < text.length && SPACE.has(text[at] ?? "")) at++;
    let value = "";
    if (text[at] === "=") {
      at++;
      while (at < text.length && SPACE.has(text[at] ?? "")) at++;
      const quote = text[at];
      if (quote === '"' || quote === "'") {
        const close = text.indexOf(quote, at + 1);
        const end = close === -1 ? text.length : close;
        value = text.slice(at + 1, end);
        opaque.push([at + 1, end]);
        at = end + 1;
      } else {
        // An unquoted value ends at a space or `>`; a quote inside it is a literal character.
        const start = at;
        while (at < text.length && !SPACE.has(text[at] ?? "") && text[at] !== ">") at++;
        value = text.slice(start, at);
        opaque.push([start, at]);
      }
    }
    if (!attributes.has(name)) attributes.set(name, value);
  }
}

/** Skips a comment or bogus comment that starts at `at` and returns the offset after it. */
function skipComment(text: string, at: number, opaque: [number, number][]): number {
  if (text.startsWith("<!--", at)) {
    // `<!-->` and `<!--->` end at once; any other comment ends at `-->` or `--!>`.
    if (text.startsWith("<!-->", at)) return at + 5;
    if (text.startsWith("<!--->", at)) return at + 6;
    const close = /--!?>/g;
    close.lastIndex = at + 4;
    const found = close.exec(text);
    const stop = found === null ? text.length : found.index + found[0].length;
    opaque.push([at, stop]);
    return stop;
  }
  const close = text.indexOf(">", at);
  const stop = close === -1 ? text.length : close + 1;
  opaque.push([at, stop]);
  return stop;
}

/**
 * Splits a document into its start tags, with each raw-text element's text. `<svg>` and `<math>` open foreign
 * content, where a browser parses `<script>` and `<style>` as markup rather than raw text; their tags carry
 * `foreign: true` so a check can refuse them.
 */
export function tokenize(text: string): Tokens {
  const tags: StartTag[] = [];
  const opaque: [number, number][] = [];
  const lower = asciiLower(text);
  let foreignDepth = 0;
  let at = 0;
  while (at < text.length) {
    const lt = text.indexOf("<", at);
    if (lt === -1) break;
    const next = text[lt + 1];
    if (next === "!") {
      if (foreignDepth > 0 && text.startsWith("<![CDATA[", lt)) {
        const close = text.indexOf("]]>", lt);
        at = close === -1 ? text.length : close + 3;
        opaque.push([lt, at]);
      } else {
        at = skipComment(text, lt, opaque);
      }
    } else if (next === "?") {
      at = skipComment(text, lt, opaque);
    } else if (next === "/") {
      if (isAlpha(text[lt + 2])) {
        let end = lt + 2;
        while (end < text.length && !SPACE.has(text[end] ?? "") && !"/>".includes(text[end] ?? "")) end++;
        const name = asciiLower(text.slice(lt + 2, end));
        if (FOREIGN_ROOTS.has(name) && foreignDepth > 0) foreignDepth--;
        // An end tag's attributes are read and dropped, so a `>` in a quoted value does not end it early.
        at = readAttributes(text, end, opaque).end;
      } else if (text[lt + 2] === ">") {
        at = lt + 3;
      } else {
        at = skipComment(text, lt, opaque);
      }
    } else if (isAlpha(next)) {
      let end = lt + 1;
      while (end < text.length && !SPACE.has(text[end] ?? "") && !"/>".includes(text[end] ?? "")) end++;
      const name = asciiLower(text.slice(lt + 1, end));
      const read = readAttributes(text, end, opaque);
      const foreign = foreignDepth > 0;
      const tagEnd = read.end;
      at = read.end;
      let rawText: string | undefined;
      let closed = false;
      if (!foreign && RAW_TEXT.has(name)) {
        const close = findEndTag(lower, name, at);
        const stop = close === -1 ? text.length : close;
        rawText = text.slice(at, stop);
        closed = close !== -1;
        opaque.push([at, stop]);
        at = stop;
      } else if (!foreign && name === "plaintext") {
        opaque.push([at, text.length]);
        at = text.length;
      }
      if (FOREIGN_ROOTS.has(name) && !read.selfClosing) foreignDepth++;
      tags.push({
        name,
        attributes: read.attributes,
        offset: lt,
        end: tagEnd,
        foreign,
        ...(rawText === undefined ? {} : { text: rawText, closed }),
      });
    } else {
      at = lt + 1;
    }
  }
  return { tags, opaque };
}

/**
 * Decodes the character references a URL check needs: numeric ones and the named ones that spell a scheme
 * (`&colon;`, `&Tab;`, `&NewLine;`). Other named references stay as written, which only makes the check stricter.
 */
export function decodeReferences(value: string): string {
  // A browser reads 0, a surrogate or a value past U+10FFFF as U+FFFD.
  const char = (code: number) =>
    String.fromCodePoint(code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? 0xfffd : code);
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => char(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);?/g, (_, dec: string) => char(Number.parseInt(dec, 10)))
    .replace(/&colon;/g, ":")
    .replace(/&Tab;/g, "\t")
    .replace(/&NewLine;/g, "\n");
}
