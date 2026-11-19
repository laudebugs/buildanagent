// The one checker every generated figure goes through before a page inlines it: a flat figure's SVG drawing and an
// isometric figure's HTML fragment. It reads the markup tag by tag and applies the rules every figure shares; each
// kind's allowlist (src/book/figures.ts) adds the elements, attributes and values its kit writes. Anything else
// throws, so a hand-edited or crafted file cannot put script, style or outside content on a page.

/** The entities the figure kits write; any other `&` in text or in an attribute value throws. */
const UNKNOWN_ENTITY = /&(?!amp;|lt;|gt;|quot;)/;

/** One figure kind's allowlist, which the shared checker calls for every tag. */
export interface MarkupRules {
  /** The figure's id: every id in the markup must start with `<figureId>--`. */
  readonly figureId: string;
  /** Prepended to every id, and to every `#id` an attribute links to, so one page can show a figure twice. */
  readonly idPrefix: string;
  /** Throws when `tag` may not open here, given the elements open around it and whether it closes itself. */
  readonly element: (tag: string, open: readonly string[], selfClosing: boolean) => void;
  /**
   * Returns one attribute as the page carries it, `name="value"`, or throws when the kind's kit never writes it. The
   * checker has already refused event handlers and unknown entities, and it prefixes ids itself.
   */
  readonly attribute: (tag: string, name: string, value: string) => string;
  /** Throws on text the kind does not allow where it stands, given the open elements. */
  readonly text?: (text: string, open: readonly string[]) => void;
  /** Rewrites a checked start tag, given its name and its checked attributes, each with a leading space. */
  readonly startTag?: (tag: string, attributes: string, selfClosing: boolean) => string;
  /** Rewrites a checked end tag. */
  readonly endTag?: (tag: string) => string;
  /** Attributes the kind's kit writes without a value, such as the anatomy card's `data-readout`; they read as "". */
  readonly bare?: readonly string[];
}

/** The attributes of a start tag, failing on one written another way than `name="value"`. */
export function attributesOf(tag: string, source: string): [name: string, value: string][] {
  const found: [string, string][] = [];
  const rest = source.replace(/\s+([A-Za-z_:][\w:.-]*)="([^"<]*)"/g, (_, name: string, value: string) => {
    found.push([name, value]);
    return "";
  });
  if (rest.trim() !== "" && rest.trim() !== "/") throw new Error(`its <${tag}> tag is malformed`);
  return found;
}

/** Checks one attribute against the rules every figure shares, then against the kind's own. */
function checkedAttribute(tag: string, name: string, value: string, rules: MarkupRules): string {
  const { figureId, idPrefix } = rules;
  if (/^on/i.test(name)) throw new Error(`its <${tag}> has an event handler, ${name}`);
  if (UNKNOWN_ENTITY.test(value)) throw new Error(`its <${tag}>'s ${name} holds an entity the kit never writes`);
  if (name === "id") {
    if (!value.startsWith(`${figureId}--`)) throw new Error(`its id "${value}" does not start with "${figureId}--"`);
    return `id="${idPrefix}${value}"`;
  }
  return rules.attribute(tag, name, value);
}

/**
 * Checks `markup` tag by tag against the shared rules and the kind's `rules`, and returns it as the page carries it.
 * Elements must nest and close; a comment, a CDATA section, a doctype, an event handler or an unknown entity, in text
 * or in an attribute value, throws wherever it stands.
 */
export function checkMarkup(markup: string, rules: MarkupRules): string {
  const open: string[] = [];
  const checked = markup.replace(/<[^>]*>|[^<]+/g, (token) => {
    if (!token.startsWith("<")) {
      if (UNKNOWN_ENTITY.test(token)) throw new Error("its text holds an entity the kit never writes");
      rules.text?.(token, open);
      return token;
    }
    const closing = /^<\/([A-Za-z][\w:-]*)>$/.exec(token);
    if (closing !== null) {
      const [, tag = ""] = closing;
      if (open.pop() !== tag) throw new Error(`its </${tag}> closes no open element`);
      return rules.endTag?.(tag) ?? token;
    }
    const start = /^<([A-Za-z][\w:-]*)([^>]*?)(\/?)>$/.exec(token);
    if (start === null) throw new Error(`it holds ${token.slice(0, 20)}, which is not an element the kit writes`);
    const [, tag = "", source = "", slash = ""] = start;
    const selfClosing = slash !== "";
    rules.element(tag, open, selfClosing);
    const written = (rules.bare ?? []).reduce(
      (text, name) => text.replace(new RegExp(String.raw`\s${name}(?=\s|/|$)`, "g"), ` ${name}=""`),
      source,
    );
    const attributes = attributesOf(tag, written)
      .map(([name, value]) => ` ${checkedAttribute(tag, name, value, rules)}`)
      .join("");
    if (!selfClosing) open.push(tag);
    return rules.startTag?.(tag, attributes, selfClosing) ?? `<${tag}${attributes}${slash}>`;
  });
  if (open.length > 0) throw new Error(`its <${open.at(-1)}> is never closed`);
  return checked;
}
