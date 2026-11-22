/**
 * What a command reads and writes. The binary gives it the process's standard streams, environment and folder; a
 * test or a host program gives it its own, so every command runs without a terminal.
 */

/** The terminal a command talks to. */
export interface CliIo {
  /** Writes to standard output: a run's answer, or its JSON lines. */
  readonly write: (text: string) => void;
  /** Writes to standard error: progress, prompts, warnings and errors. */
  readonly error: (text: string) => void;
  /** Reads the next line of standard input without its line break, or `undefined` once input has ended. */
  readonly readLine: () => Promise<string | undefined>;
  /** The environment variables. The CLI reads `HOME`, `XDG_STATE_HOME` and the key of the provider `--model` names. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The folder a new session records as its working folder. */
  readonly cwd: string;
}

/** Splits a stream of text or bytes into lines at `\n`, dropping a `\r` before it. */
export async function* linesOf(chunks: AsyncIterable<string | Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let rest = "";
  for await (const chunk of chunks) {
    rest += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let end = rest.indexOf("\n");
    while (end >= 0) {
      yield rest.slice(0, end).replace(/\r$/, "");
      rest = rest.slice(end + 1);
      end = rest.indexOf("\n");
    }
  }
  rest += decoder.decode();
  if (rest !== "") yield rest.replace(/\r$/, "");
}
