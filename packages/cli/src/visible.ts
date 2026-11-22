/**
 * Makes text from the model or the log safe to print. A control character in a command, a reason or a tool result
 * would otherwise act on the terminal: a `\r` returns the cursor and the text after it overwrites what an approver
 * read, and an escape sequence can move the cursor, clear the line or recolour it. Each one is shown as an escape
 * instead, so the approver sees that it is there; nothing is dropped. Unicode's direction overrides and invisible
 * separators are escaped too, because they reorder or hide the text around them in the same way.
 */

const NAMED: Readonly<Record<string, string>> = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };

type Range = readonly [number, number];

// The control characters below space, DEL and those from 0x80 to 0x9f, the soft hyphen, the combining grapheme
// joiner, the Arabic letter mark, the Mongolian vowel separator, the zero-width characters, the bidirectional marks,
// embeddings, overrides and isolates, the line and paragraph separators, the word joiner and the invisible operators,
// the variation selectors, the byte-order mark, the tag characters, and a surrogate that pairs with nothing. A
// variation selector or a tag character draws nothing, so a run of them can carry text an approver never sees.
const INVISIBLE: readonly Range[] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x34f, 0x34f],
  [0x61c, 0x61c],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xd800, 0xdfff],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xe0000, 0xe007f],
  [0xe0100, 0xe01ef],
];

// The spaces that are not ASCII's. The shell reads a no-break space as part of a word, so on one line, such as a
// command, `rm a<no-break space>b` would otherwise read as removing two files.
const SPACES: readonly Range[] = [
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
];

const within = (code: number, ranges: readonly Range[]): boolean =>
  ranges.some(([low, high]) => code >= low && code <= high);

// Every code point outside printable ASCII, which the functions below then sort into safe and unsafe. The `u` flag
// makes a character beyond U+FFFF, such as a tag character, one match instead of two halves of a surrogate pair.
const NOT_PRINTABLE_ASCII = /[^ -~]/gu;

const codeOf = (char: string): number => char.codePointAt(0) as number;

function escaped(char: string): string {
  const named = NAMED[char];
  if (named !== undefined) return named;
  const code = codeOf(char);
  const hex = code.toString(16);
  if (code <= 0xff) return `\\x${hex.padStart(2, "0")}`;
  return code <= 0xffff ? `\\u${hex.padStart(4, "0")}` : `\\u{${hex}}`;
}

/** `text` on one line, with every control character, invisible character and non-ASCII space shown as an escape. */
export const visible = (text: string): string =>
  text.replace(NOT_PRINTABLE_ASCII, (char) => {
    const code = codeOf(char);
    return within(code, INVISIBLE) || within(code, SPACES) ? escaped(char) : char;
  });

/** `text` with its line breaks, tabs and spaces kept, and every other control or invisible character escaped. */
export const visibleBlock = (text: string): string =>
  text.replace(NOT_PRINTABLE_ASCII, (char) =>
    char !== "\n" && char !== "\t" && within(codeOf(char), INVISIBLE) ? escaped(char) : char,
  );
