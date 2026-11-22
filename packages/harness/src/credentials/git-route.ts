/**
 * The checks of a git route: git's smart HTTP protocol over a credential route, limited to listed repositories and,
 * for a push, to listed branches. It is pure and portable, so the proxy and any other backend can share it. Everything
 * it doesn't understand is refused: an unknown path, a query, a push certificate, a pkt-line it can't read, a command
 * list past its size limit, a deletion, a tag and any ref outside the patterns.
 */
import { HarnessError } from "../errors.js";

/** What a git route lets through. */
export interface GitRouteFilter {
  /** The repositories the route reaches, as `owner/name`. Compared without case, as GitHub does. */
  readonly repositories: readonly string[];
  /**
   * The branches a push may create or update, as `refs/heads/<name>` or a prefix ending in `/*`, such as
   * `refs/heads/agent/*`. Leave it empty to refuse every push. A deletion and a tag are always refused.
   */
  readonly pushRefs: readonly string[];
  /** Whether a fetch or clone may read the repositories. A fetch is not limited by ref. */
  readonly fetch: boolean;
  /** The user name sent with the credential in HTTP Basic, such as `x-access-token` for a GitHub App token. */
  readonly username: string;
}

/** A git request the route accepts: which service, and whether it is the ref advertisement or the request itself. */
export interface GitEndpoint {
  readonly service: "git-receive-pack" | "git-upload-pack";
  readonly phase: "advertise" | "rpc";
}

/** The most bytes of a push's command list, before its flush, that the route reads. A longer list is refused. */
export const GIT_MAX_COMMAND_BYTES = 64 * 1024;
/** The most ref updates in one push. */
export const GIT_MAX_COMMANDS = 64;

const PKT_MAX = 65520;
const SEGMENT = /^[A-Za-z0-9_.-]+$/;
const REPOSITORY_PATH = /^\/([^/]+)\/([^/]+)\/(info\/refs|git-receive-pack|git-upload-pack)$/;
const OID = "([0-9a-f]{40}|[0-9a-f]{64})";
const COMMAND = new RegExp(`^${OID} ${OID} (\\S+)$`);
const SHALLOW = new RegExp(`^shallow ${OID}$`);
const ZERO = /^0+$/;
const USERNAME = /^[A-Za-z0-9._-]{1,64}$/;

const invalid = (message: string) => new HarnessError("invalid_egress_options", message);

/** Whether `name` is a ref name git itself would accept, by `git check-ref-format`'s rules, under `refs/`. */
export function isValidRefName(name: string): boolean {
  if (!name.startsWith("refs/") || name.length > 1024) return false;
  const control = [...name].some((char) => char.charCodeAt(0) <= 0x20 || char.charCodeAt(0) === 0x7f);
  if (control || /[~^:?*[\\]/.test(name) || name.includes("..") || name.includes("@{") || name.includes("//")) {
    return false;
  }
  if (name.endsWith("/") || name.endsWith(".")) return false;
  return name.split("/").every((part) => part !== "" && !part.startsWith(".") && !part.endsWith(".lock"));
}

/** Throws unless `pattern` is a branch, or a branch prefix ending in `/*`, under `refs/heads/`. */
function checkPattern(pattern: unknown, index: number): void {
  const text = typeof pattern === "string" ? pattern : "";
  const bare = text.endsWith("/*") ? `${text.slice(0, -2)}/x` : text;
  if (!text.startsWith("refs/heads/") || !isValidRefName(bare)) {
    throw invalid(`push ref ${index} must be a branch, or a branch prefix ending in /*, under refs/heads/`);
  }
}

/** Throws unless every field of a git route's filter is usable. The message names the field, never its value. */
export function checkGitFilter(filter: GitRouteFilter): void {
  const { repositories, pushRefs, fetch, username } = filter;
  if (!Array.isArray(repositories) || repositories.length === 0) {
    throw invalid("a git route needs at least one repository, as owner/name");
  }
  repositories.forEach((repository: unknown, index) => {
    const parts = typeof repository === "string" ? repository.split("/") : [];
    const usable = parts.length === 2 && parts.every((part) => SEGMENT.test(part) && !/^\.+$/.test(part));
    if (!usable) throw invalid(`repository ${index} must be owner/name`);
  });
  if (!Array.isArray(pushRefs)) throw invalid("a git route's pushRefs must be a list");
  pushRefs.forEach(checkPattern);
  if (typeof fetch !== "boolean") throw invalid("a git route's fetch must be true or false");
  if (pushRefs.length === 0 && !fetch) throw invalid("a git route must allow a push, a fetch or both");
  if (typeof username !== "string" || !USERNAME.test(username)) throw invalid("a git route's username is not usable");
}

/** The repository `owner/name` in lower case, without a trailing `.git`. */
const repositoryKey = (owner: string, name: string): string => `${owner}/${name.replace(/\.git$/i, "")}`.toLowerCase();

/**
 * The git endpoint a request is for, or the reason it is refused. `path` is the part after the route's name, and
 * `query` is the search part with its `?`, or empty.
 */
export function gitEndpoint(
  filter: GitRouteFilter,
  method: string,
  path: string,
  query: string,
): GitEndpoint | { readonly refused: string } {
  const match = REPOSITORY_PATH.exec(path);
  const [, owner = "", name = "", action = ""] = match ?? [];
  if (match === null || ![owner, name].every((part) => SEGMENT.test(part) && !/^\.+$/.test(part))) {
    return { refused: "git_path_refused" };
  }
  const listed = filter.repositories.map((repository) => repositoryKey(...(repository.split("/") as [string, string])));
  if (!listed.includes(repositoryKey(owner, name))) return { refused: "git_repository_refused" };
  const endpoint = endpointOf(action, method.toUpperCase(), query);
  if (endpoint === undefined) return { refused: "git_path_refused" };
  if (endpoint.service === "git-receive-pack" && filter.pushRefs.length === 0) return { refused: "git_push_refused" };
  if (endpoint.service === "git-upload-pack" && !filter.fetch) return { refused: "git_fetch_refused" };
  return endpoint;
}

function endpointOf(action: string, method: string, query: string): GitEndpoint | undefined {
  if (action === "info/refs") {
    if (method !== "GET") return undefined;
    if (query === "?service=git-receive-pack") return { service: "git-receive-pack", phase: "advertise" };
    if (query === "?service=git-upload-pack") return { service: "git-upload-pack", phase: "advertise" };
    return undefined;
  }
  if (method !== "POST" || query !== "") return undefined;
  return { service: action as GitEndpoint["service"], phase: "rpc" };
}

/** One ref update in a push. */
interface PushCommand {
  readonly old: string;
  readonly new: string;
  readonly ref: string;
}

const DECODER = new TextDecoder("utf-8", { fatal: true });
const LENGTH = /^[0-9a-fA-F]{4}$/;
const BAD: { readonly refused: string } = { refused: "git_bad_pkt_line" };
const FLUSH_LENGTH = 4;

/** The text of one pkt-line's payload without its line feed, or `undefined` when it isn't UTF-8. */
function payloadText(bytes: Uint8Array): string | undefined {
  try {
    return DECODER.decode(bytes).replace(/\n$/, "");
  } catch {
    return undefined;
  }
}

/** Reads one command line; the first carries the capabilities after a NUL, which are dropped. */
function readCommand(text: string, commands: PushCommand[]): string | undefined {
  if (commands.length === 0 && SHALLOW.test(text)) return undefined;
  if (text.startsWith("push-cert")) return "git_push_cert";
  const line = commands.length === 0 ? (text.split("\0")[0] ?? "") : text;
  if (commands.length > 0 && text.includes("\0")) return "git_bad_pkt_line";
  const match = COMMAND.exec(line);
  if (match === null || match[1]?.length !== match[2]?.length) return "git_bad_pkt_line";
  commands.push({ old: match[1] ?? "", new: match[2] ?? "", ref: match[3] ?? "" });
  return commands.length > GIT_MAX_COMMANDS ? "git_too_many_commands" : undefined;
}

/**
 * One pkt-line at `at` in `bytes`, which starts at body offset `offset`: a flush, a payload's text, how many bytes from
 * `at` it needs before it can be read, or a refusal. A line that would end past `GIT_MAX_COMMAND_BYTES` is refused from
 * its header, so the reader never holds much more than the limit.
 */
function readPacket(
  bytes: Uint8Array,
  at: number,
  offset: number,
):
  | { readonly needed: number }
  | { readonly refused: string }
  | "flush"
  | { readonly text: string; readonly length: number } {
  if (bytes.length - at < 4) return { needed: 4 };
  const header = String.fromCharCode(...bytes.subarray(at, at + 4));
  if (!LENGTH.test(header)) return BAD;
  const length = Number.parseInt(header, 16);
  if (length === 0) return "flush";
  if (length < 5 || length > PKT_MAX) return BAD;
  if (offset + at + length > GIT_MAX_COMMAND_BYTES) return { refused: "git_too_large" };
  if (bytes.length - at < length) return { needed: length };
  const text = payloadText(bytes.subarray(at + 4, at + length));
  return text === undefined ? BAD : { text, length };
}

/** The chunks joined into one array, or the one chunk itself. */
function join(chunks: readonly Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0] as Uint8Array;
  const joined = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  return joined;
}

/** A push check's verdict so far: `incomplete` until the command list reaches its flush, or the route's verdict. */
export type PushCheckVerdict = "incomplete" | "allowed" | { readonly refused: string };

/**
 * Reads the command list at the start of a push body as the body arrives, in pieces of any size, and gives the route's
 * verdict once it can. The work is linear in the bytes received: pieces are joined only once they hold the next
 * pkt-line's header or the whole line, and a line already read is never read again. A list whose lines end past
 * `GIT_MAX_COMMAND_BYTES` is refused as soon as a header says so, however the body is split.
 */
export class PushReader {
  readonly #filter: GitRouteFilter;
  #pending: Uint8Array[] = [];
  #pendingBytes = 0;
  /** The body offset of the first pending byte. Every byte before it belongs to a pkt-line already read. */
  #offset = 0;
  /** How many pending bytes the next pkt-line needs before it can be read. */
  #needed = 4;
  readonly #commands: PushCommand[] = [];
  /** Whether the body so far is exactly one flush, git's probe before a large push. */
  #probe = false;
  #verdict: "allowed" | { readonly refused: string } | undefined;

  constructor(filter: GitRouteFilter) {
    this.#filter = filter;
  }

  /** Reads the next piece of the body and returns the verdict so far. Bytes after a verdict are not read. */
  add(chunk: Uint8Array): PushCheckVerdict {
    if (this.#verdict !== undefined) return this.#verdict;
    if (chunk.length === 0) return "incomplete";
    // The probe is a body of one flush and nothing else, so any byte after it is refused.
    if (this.#probe) return this.#settle(BAD);
    this.#pending.push(chunk);
    this.#pendingBytes += chunk.length;
    return this.#pendingBytes < this.#needed ? "incomplete" : this.#read();
  }

  /** Says the body has ended and returns the final verdict: a list still incomplete is refused. */
  end(): "allowed" | { readonly refused: string } {
    return this.#verdict ?? this.#settle(this.#probe ? "allowed" : BAD);
  }

  #read(): PushCheckVerdict {
    const bytes = join(this.#pending);
    let at = 0;
    for (;;) {
      const packet = readPacket(bytes, at, this.#offset);
      if (packet === "flush") return this.#flush(bytes, at);
      if ("refused" in packet) return this.#settle(packet);
      if ("needed" in packet) {
        this.#pending = at < bytes.length ? [bytes.subarray(at)] : [];
        this.#pendingBytes = bytes.length - at;
        this.#offset += at;
        this.#needed = packet.needed;
        return "incomplete";
      }
      const refused = readCommand(packet.text, this.#commands);
      if (refused !== undefined) return this.#settle({ refused });
      at += packet.length;
    }
  }

  /** The verdict at a flush at `at`: the end of the command list, git's probe, or a flush with no command before it. */
  #flush(bytes: Uint8Array, at: number): PushCheckVerdict {
    if (this.#commands.length > 0) return this.#settle(commandsVerdict(this.#commands, this.#filter));
    if (this.#offset + at !== 0 || bytes.length > FLUSH_LENGTH) return this.#settle(BAD);
    this.#probe = true;
    this.#pending = [];
    this.#pendingBytes = 0;
    return "incomplete";
  }

  #settle(verdict: "allowed" | { readonly refused: string }): "allowed" | { readonly refused: string } {
    this.#verdict = verdict;
    this.#pending = [];
    this.#pendingBytes = 0;
    return verdict;
  }
}

/** Whether `ref` is matched by one of the patterns: exactly, or under a prefix that ends in `/*`. */
function refAllowed(ref: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) =>
    pattern.endsWith("/*") ? ref.startsWith(pattern.slice(0, -1)) && ref.length > pattern.length - 1 : ref === pattern,
  );
}

/** Whether every command creates or updates a ref the patterns allow, or why not. */
function commandsVerdict(
  commands: readonly PushCommand[],
  filter: GitRouteFilter,
): "allowed" | { readonly refused: string } {
  for (const command of commands) {
    if (ZERO.test(command.new)) return { refused: "git_delete_refused" };
    if (!isValidRefName(command.ref) || !refAllowed(command.ref, filter.pushRefs))
      return { refused: "git_ref_refused" };
  }
  return "allowed";
}

/**
 * The route's verdict on the start of a push body: `incomplete` while the command list hasn't reached its flush,
 * `allowed` once every command creates or updates a ref the patterns allow, or the reason it is refused. A body that is
 * exactly one flush packet, the probe git sends before a large push, is `allowed` once it has ended, because it updates
 * no ref; a byte after that flush is refused. `ended` says the body has no more bytes, so a list still incomplete is
 * refused. A list whose lines end past `GIT_MAX_COMMAND_BYTES` is refused, whether or not its flush has arrived.
 */
export function pushVerdict(
  bytes: Uint8Array,
  filter: GitRouteFilter,
  ended: boolean,
): "incomplete" | "allowed" | { readonly refused: string } {
  const reader = new PushReader(filter);
  const verdict = reader.add(bytes);
  return verdict === "incomplete" && ended ? reader.end() : verdict;
}

/** Whether an `Authorization` header is HTTP Basic whose password is exactly `sentinel`. */
export function basicCarries(header: string | undefined, sentinel: string): boolean {
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(header ?? "");
  if (match === null || sentinel === "") return false;
  let decoded: string;
  try {
    decoded = atob(match[1] ?? "");
  } catch {
    return false;
  }
  const colon = decoded.indexOf(":");
  return colon >= 0 && decoded.slice(colon + 1) === sentinel;
}

/** The `Authorization` value that carries `secret` as the password of `username`. */
export function basicHeader(username: string, secret: string): string {
  const bytes = new TextEncoder().encode(`${username}:${secret}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}
