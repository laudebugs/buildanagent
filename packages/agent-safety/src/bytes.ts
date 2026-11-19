/**
 * Byte helpers for the signers: base64url without padding (RFC 4648 §5), and a comparison whose running time doesn't
 * depend on where two byte strings first differ. Web-standard APIs only, so they run on every target.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const VALUE = new Map([...ALPHABET].map((char, index) => [char, index]));

/** Encodes bytes as base64url with no padding. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    // Missing bytes of the last group count as zero; the characters they would fill are left off below.
    const chunk = ((bytes[index] ?? 0) << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - index) * 8) / 6));
    for (let shift = 0; shift < chars; shift++) out += ALPHABET[(chunk >> (18 - 6 * shift)) & 63];
  }
  return out;
}

/**
 * Decodes unpadded base64url. Returns `undefined` for any text that isn't the canonical encoding of some bytes: a
 * character outside the alphabet, padding, a length no encoding has, or unused low bits that aren't zero. Refusing a
 * non-canonical form keeps one signature from having two spellings.
 */
export function fromBase64Url(text: string): Uint8Array | undefined {
  if (text.length % 4 === 1) return undefined;
  const bytes = new Uint8Array(Math.floor((text.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let out = 0;
  for (const char of text) {
    const value = VALUE.get(char);
    if (value === undefined) return undefined;
    buffer = ((buffer << 6) | value) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[out++] = (buffer >> bits) & 0xff;
    }
  }
  // The bits left over after the last whole byte must be zero, or two texts would decode to the same bytes.
  if ((buffer & ((1 << bits) - 1)) !== 0) return undefined;
  return bytes;
}

/**
 * True when two byte strings are equal. It compares every byte, whatever the first difference, so the time it takes
 * reveals only the lengths, which are public for a MAC.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}
