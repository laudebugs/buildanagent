import { isTranscript, parseExampleRef } from "../src/plugins/example-code.js";

/** The fence languages that mean a terminal session whatever the code holds. */
const SESSION_LANGS: ReadonlySet<string> = new Set([
  "console",
  "terminal",
  "shellsession",
  "shell-session",
  "sh-session",
]);

/** The fence languages in which a line that starts with a `$ ` prompt marks a typed session. */
const SHELL_LANGS: ReadonlySet<string> = new Set(["", "bash", "sh", "shell", "zsh", "text", "txt", "plaintext"]);

/** A fence's language, meta string and code: the parts of a `Fence` that these checks read. */
export interface FenceLike {
  readonly lang: string;
  readonly meta: string;
  readonly code: string;
}

/** Whether the fence names a transcript file under a package's `transcripts/` folder. */
export function namesTranscript(fence: FenceLike): boolean {
  const ref = parseExampleRef(fence.meta);
  return ref !== undefined && isTranscript(ref.file);
}

/**
 * Whether the fence shows a terminal session that nothing checks: a `console` fence, or a shell block with a line that
 * starts with a `$ ` prompt, that names no transcript. An install line has no prompt, so it never counts.
 */
export function isTypedSession(fence: FenceLike): boolean {
  if (namesTranscript(fence)) return false;
  const lang = fence.lang.toLowerCase();
  if (SESSION_LANGS.has(lang)) return true;
  return SHELL_LANGS.has(lang) && fence.code.split("\n").some((line) => /^\s*\$ /.test(line));
}
