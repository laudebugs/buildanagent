/**
 * The "Copy as Markdown" button's behaviour, kept apart from PageTitle.astro so a test can drive it with fakes.
 *
 * Safari lets a page write to the clipboard only inside the user's click, and the permission ends when the handler
 * yields to a network request. So the handler is not `async` and `await`s nothing: it starts the fetch and passes the
 * unfinished promise to `ClipboardItem`, which the clipboard API accepts in place of a blob and settles later while the
 * click's permission holds. The blob's type must be exactly the key's, `text/plain`, so the Markdown is rebuilt as text
 * and not passed through as the response's `text/markdown` blob. Where `ClipboardItem` is missing, or the write is
 * refused, the handler falls back to `writeText` with the text a hover or focus fetched ahead of the click.
 *
 * The script that calls this is static text with no values spliced in, so a Content-Security-Policy can allow it by
 * hash or as a same-origin file; the twin's address comes from the button's `data-twin` attribute.
 */

/** The browser parts the button uses, so a test can pass fakes. The page passes the real globals. */
export interface CopyEnvironment {
  readonly fetch: (url: string) => Promise<{ readonly ok: boolean; text(): Promise<string> }>;
  readonly clipboard:
    | {
        write?(items: unknown[]): Promise<void>;
        writeText?(text: string): Promise<void>;
      }
    | undefined;
  readonly ClipboardItem: (new (items: Record<string, Promise<unknown>>) => unknown) | undefined;
  readonly Blob: new (parts: string[], options: { type: string }) => unknown;
}

/** The parts of a button and its status line the behaviour touches. */
export interface CopyButton {
  readonly dataset: { twin?: string };
  addEventListener(type: string, listener: () => void): void;
  /** Shows the status text for a moment and leaves it for a screen reader, which reads the live region it sits in. */
  announce(message: string): void;
}

/** The words the status line shows. */
export const STATUS = { copied: "Copied", failed: "Copy failed" } as const;

/** Adds the click handler to `button`. Does nothing for a button with no `data-twin`. */
export function wireCopyButton(button: CopyButton, env: CopyEnvironment): void {
  const url = button.dataset.twin;
  if (url === undefined || url === "") return;
  let text: Promise<string> | undefined;
  const load = (): Promise<string> => {
    text ??= env.fetch(url).then((response) => {
      if (!response.ok) throw new Error(`${url} answered with an error`);
      return response.text();
    });
    // A failed fetch is not kept, so the next click tries again.
    text.catch(() => {
      text = undefined;
    });
    return text;
  };
  // Fetching ahead of the click keeps the fallback's text ready, so `writeText` can run with no wait.
  const warm = (): void => {
    load().catch(() => {});
  };
  button.addEventListener("pointerenter", warm);
  button.addEventListener("focus", warm);
  button.addEventListener("click", () => {
    const done = () => button.announce(STATUS.copied);
    const failed = () => button.announce(STATUS.failed);
    const { clipboard } = env;
    if (clipboard?.write !== undefined && env.ClipboardItem !== undefined) {
      const markdown = load().then((body) => new env.Blob([body], { type: "text/plain" }));
      // The clipboard reports a failed fetch through `write`; this keeps the promise from also being unhandled.
      markdown.catch(() => {});
      const item = new env.ClipboardItem({ "text/plain": markdown });
      clipboard.write([item]).then(done, () => {
        // The write was refused; the pre-fetched text may still go through writeText.
        load()
          .then((body) => clipboard.writeText?.(body))
          .then(done, failed);
      });
      return;
    }
    if (clipboard?.writeText === undefined) return failed();
    load()
      .then((body) => clipboard.writeText?.(body))
      .then(done, failed);
  });
}
