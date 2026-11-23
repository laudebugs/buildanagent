/**
 * A memory record and its file: one Markdown file per record, with the fields in front matter and the fact as the
 * body. Each front-matter value is a JSON string or `null`, so a value can hold any character on one line and a
 * reader of the file never has to guess where it ends. Expiry is computed from the injected clock alone.
 */

/** What a record is about: a fact about the project, a note for the task at hand, or something the user prefers. */
export type MemoryType = "project" | "task" | "preference";

/** `low` for a record written in a session that had received output from a tool whose output is untrusted. */
export type MemoryTrust = "trusted" | "low";

/** One durable fact, with where it came from and how long it holds. */
export interface MemoryRecord {
  /** A short name for the fact, which the index shows. One line. */
  readonly subject: string;
  /** The fact itself, which only a `view` of the record shows. */
  readonly fact: string;
  /** Where the fact can be checked: a `file:line`, a URL, or the user's own words. One line. */
  readonly source: string;
  readonly type: MemoryType;
  /** When the record was first written, as an ISO 8601 date and time. */
  readonly created: string;
  /** When the record was last written or confirmed. A `view` never moves it. */
  readonly validated: string;
  /** When the record stops being shown, or `null` for a trusted preference, which holds until it is changed. */
  readonly expires: string | null;
  readonly trust: MemoryTrust;
  /** For a task record: the session that wrote it, whose end expires it. */
  readonly session?: string;
}

/** How long a record holds after its last validation, by type and trust, in days. `null` holds until changed. */
export const MEMORY_EXPIRY_DAYS: Readonly<Record<MemoryType, Readonly<Record<MemoryTrust, number | null>>>> = {
  project: { trusted: 90, low: 30 },
  // A task record ends with its session; the period is the latest it holds when the session never ends cleanly.
  task: { trusted: 7, low: 1 },
  preference: { trusted: null, low: 30 },
};

/** The most bytes of one record's file. A longer write is refused, and a longer file is not read. */
export const MEMORY_RECORD_MAX_BYTES = 16 * 1024;

const DAY_MS = 86_400_000;
const TYPES: readonly string[] = ["project", "task", "preference"];
const TRUSTS: readonly string[] = ["trusted", "low"];
const FIELDS = ["subject", "source", "type", "created", "validated", "expires", "trust", "session"] as const;

/** When a record of `type` and `trust` validated at `validated` expires, by the periods alone. */
export function expiryOf(type: MemoryType, trust: MemoryTrust, validated: string): string | null {
  const days = MEMORY_EXPIRY_DAYS[type][trust];
  return days === null ? null : new Date(Date.parse(validated) + days * DAY_MS).toISOString();
}

/**
 * Whether the record no longer holds at `now`. The stored `expires` and the period its type and trust give are both
 * checked, and the earlier wins, so a file edited by hand to a later date, or a trust it never had, expires on time.
 */
export function isExpired(record: MemoryRecord, now: Date): boolean {
  const computed = expiryOf(record.type, record.trust, record.validated);
  const ends = [record.expires, computed].filter((at): at is string => at !== null).map((at) => Date.parse(at));
  return ends.some((at) => Number.isNaN(at) || now.getTime() >= at);
}

/** The record's file: front matter, then the fact. */
export function formatRecord(record: MemoryRecord): string {
  const lines = FIELDS.flatMap((field) => {
    const value = record[field];
    if (value === undefined) return [];
    return [`${field}: ${JSON.stringify(value)}`];
  });
  return `---\n${lines.join("\n")}\n---\n${record.fact}\n`;
}

const isDate = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));

/** The front matter's fields and the body after it, or `undefined` when the text has no front matter it can read. */
function frontMatter(text: string): { fields: Record<string, unknown>; body: string } | undefined {
  if (!text.startsWith("---\n")) return undefined;
  const end = text.indexOf("\n---\n", 3);
  if (end < 0) return undefined;
  const fields: Record<string, unknown> = {};
  for (const line of text.slice(4, end).split("\n")) {
    const at = line.indexOf(": ");
    if (at < 0) return undefined;
    try {
      fields[line.slice(0, at)] = JSON.parse(line.slice(at + 2));
    } catch {
      return undefined;
    }
  }
  return { fields, body: text.slice(end + 5).replace(/\n$/, "") };
}

/** Whether the fields are a record's, each of its kind. */
function isRecordFields(fields: Record<string, unknown>): boolean {
  const { subject, source, type, created, validated, expires, trust, session } = fields;
  return (
    typeof subject === "string" &&
    typeof source === "string" &&
    TYPES.includes(type as string) &&
    TRUSTS.includes(trust as string) &&
    isDate(created) &&
    isDate(validated) &&
    (expires === null || isDate(expires)) &&
    (session === undefined || typeof session === "string")
  );
}

/** A record from its file, or `undefined` when the file is not one: a missing field, a bad value or no front matter. */
export function parseRecord(text: string): MemoryRecord | undefined {
  const parsed = frontMatter(text);
  if (parsed === undefined || !isRecordFields(parsed.fields)) return undefined;
  const { subject, source, type, created, validated, expires, trust, session } = parsed.fields as Record<
    string,
    string
  >;
  return {
    subject,
    fact: parsed.body,
    source,
    type: type as MemoryType,
    created,
    validated,
    expires: expires ?? null,
    trust: trust as MemoryTrust,
    ...(session === undefined ? {} : { session }),
  } as MemoryRecord;
}
