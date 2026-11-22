/**
 * `scrubSecrets()`: removes known secrets from a session entry before it is appended, so a credential that reached a
 * tool result, a model message or an error never reaches the log. It is the net under the credential boundary, not the
 * boundary itself: the boundary keeps the secret out of the sandbox, and this catches what a host-side tool wrote
 * anyway. It is pure and portable.
 */
import type { SessionEntry } from "@buildanagent/protocol";

/** What replaces a secret. */
export const REDACTED = "[REDACTED]";

// Fields that give an entry its shape and place in the log. A secret is never one of them, and changing one would break
// the log, so they are left alone at the top of an entry.
const STRUCTURAL = new Set(["type", "id", "parentId", "seq", "timestamp", "origin", "formatVersion"]);

/** The standard and URL-safe base64 of `bytes`, without padding. */
function base64Of(bytes: Uint8Array): string[] {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const standard = btoa(binary).replace(/=+$/, "");
  return [standard, standard.replaceAll("+", "-").replaceAll("/", "_")];
}

// The fewest base64 characters worth looking for, so a short secret's pieces don't redact ordinary text.
const MIN_BASE64_PIECE = 8;

/**
 * The base64 forms of a secret: alone, and as part of longer text. Base64 packs three bytes into four characters, so a
 * secret that follows a prefix such as `user:` encodes differently by its offset in the group. The encodings at all three
 * offsets are kept, trimmed to the groups the secret fills, because the groups at its edges depend on its neighbours.
 */
function base64Forms(text: string): string[] {
  const secret = new TextEncoder().encode(text);
  const found = new Set(base64Of(secret));
  for (let offset = 0; offset < 3; offset += 1) {
    const shifted = new Uint8Array(offset + secret.length);
    shifted.set(secret, offset);
    const groups = Math.floor(shifted.length / 3);
    for (const form of base64Of(shifted)) {
      const piece = form.slice(offset === 0 ? 0 : 4, groups * 4);
      if (piece.length >= MIN_BASE64_PIECE) found.add(piece);
    }
  }
  return [...found];
}

/**
 * The forms a secret takes when something copies it: as written, percent-encoded, escaped inside JSON, and base64 (which
 * is how a Basic authorization header carries one). Longest first, so a secret that contains another is removed whole.
 */
function forms(secrets: readonly string[]): string[] {
  const found = new Set<string>();
  for (const secret of secrets) {
    if (secret === "") continue;
    found.add(secret);
    found.add(encodeURIComponent(secret));
    found.add(JSON.stringify(secret).slice(1, -1));
    for (const form of base64Forms(secret)) found.add(form);
  }
  found.delete("");
  return [...found].sort((a, b) => b.length - a.length);
}

function scrubText(text: string, patterns: readonly string[]): string {
  let result = text;
  for (const pattern of patterns) {
    if (result.includes(pattern)) result = result.replaceAll(pattern, REDACTED);
  }
  return result;
}

function scrubValue(value: unknown, patterns: readonly string[]): unknown {
  if (typeof value === "string") return scrubText(value, patterns);
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, patterns));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[scrubText(key, patterns)] = scrubValue(inner, patterns);
    return out;
  }
  return value;
}

/**
 * Returns a copy of `entry` with every secret replaced by `[REDACTED]`, in every string value and every key, at any depth.
 * A secret is also removed when it appears percent-encoded, JSON-escaped or in base64. The entry's `type`, `id`,
 * `parentId`, `seq`, `timestamp`, `origin` and `formatVersion` are kept as they are. An empty secret is ignored, and a short one redacts
 * every place it occurs, so pass real credentials. The input is not changed.
 */
export function scrubSecrets<T extends SessionEntry>(entry: T, secrets: readonly string[]): T {
  const patterns = forms(secrets);
  if (patterns.length === 0) return entry;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    out[STRUCTURAL.has(key) ? key : scrubText(key, patterns)] = STRUCTURAL.has(key)
      ? value
      : scrubValue(value, patterns);
  }
  return out as T;
}
