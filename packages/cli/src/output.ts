/**
 * Where a command's results go. With `--json` every result is one JSON object on its own line of standard output,
 * so a script reads the stream line by line. Without it, results are text, and progress and warnings go to standard
 * error so standard output holds only the answer.
 */
import type { CliIo } from "./io.js";

/** A command's output, as text or as JSON lines. */
export class Output {
  readonly json: boolean;
  readonly #io: CliIo;

  constructor(io: CliIo, json: boolean) {
    this.#io = io;
    this.json = json;
  }

  /** Writes one JSON object as one line of standard output. */
  line(value: object): void {
    this.#io.write(`${JSON.stringify(value)}\n`);
  }

  /** A result: `text` on standard output, or `value` as a JSON line. */
  result(text: string, value: object): void {
    if (this.json) this.line(value);
    else this.#io.write(`${text}\n`);
  }

  /** Progress or a warning: `text` on standard error, or `value` as a JSON line. */
  note(text: string, value: object): void {
    if (this.json) this.line(value);
    else this.#io.error(`${text}\n`);
  }
}
