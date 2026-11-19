import { escapeHtml } from "./listing-html.js";
import type { ReplayEvent } from "./types.js";

// The replay of a recorded run as HTML strings, which the Replay and StepControls components and a chapter's
// `::listing{… replay}` all render, so a replay reads the same in the gallery and in a chapter.

/**
 * Back, next and the step count for a stepper or a replay, plus restart and play for a replay. The controls render
 * hidden and src/scripts/steps.ts shows them, so a page without JavaScript shows no dead buttons.
 */
export function stepControlsHtml(label: string, replay: boolean): string {
  const control = (action: string, text: string, extra = "") =>
    `<button type="button" class="control" data-step-action="${action}"${extra}>${text}</button>`;
  return [
    `<div class="controls" role="group" aria-label="${escapeHtml(label)}" data-step-controls hidden>`,
    replay ? control("restart", "Restart") : "",
    control("back", "Back"),
    replay ? control("play", "Play", ' aria-pressed="false"') : "",
    control("next", "Next"),
    '<span class="controls__status label" data-step-status aria-live="polite"></span>',
    "</div>",
  ].join("");
}

export interface ReplayOptions {
  readonly id: string;
  readonly title: string;
  /** Where the run comes from, such as the transcript's path. */
  readonly source: string;
  readonly events: readonly ReplayEvent[];
  /** The id of the listing whose lines the replay highlights as it steps, when it has one. */
  readonly listing?: string;
  /** The accessible name of the controls; "Replay of <title>" unless given. */
  readonly controlsLabel?: string;
  /** The file lines the listing shows. With them, each event says where it came from, or that the listing lacks it. */
  readonly listingLines?: ReadonlySet<number>;
}

/**
 * Where an event came from, as the replay says it beside a listing: the listed line it highlights, a line the
 * listing leaves out, or no line at all. Shown with or without JavaScript, so a step that highlights nothing says why.
 */
export function eventWhere(line: number | undefined, listingLines: ReadonlySet<number>): string {
  if (line === undefined) return "no source line";
  return listingLines.has(line) ? `line ${line}` : `line ${line}, outside this listing`;
}

/**
 * A path, escaped, that wraps only after a slash: each name and its slash is one inline block, so the line breaks
 * between names, never at a hyphen inside one, unless a single name is wider than the panel.
 */
function breakAtSlashes(path: string): string {
  return path
    .split(/(?<=\/)/)
    .map((part) => `<span class="replay__segment">${escapeHtml(part)}</span>`)
    .join("");
}

/**
 * A recorded run as a panel. Without JavaScript every event shows in order, as a numbered list; src/scripts/steps.ts
 * reveals them one by one with back, next, restart and play, and highlights the listing line an event names.
 */
export function replayHtml(options: ReplayOptions): string {
  const { id, title, source, events, listing, controlsLabel, listingLines } = options;
  const items = events
    .map((event, index) => {
      // Only a line the listing shows is one the script can highlight.
      const shown = event.line !== undefined && (listingLines === undefined || listingLines.has(event.line));
      const line = shown ? ` data-line="${event.line}"` : "";
      const where =
        listingLines === undefined
          ? ""
          : `<span class="replay__where">${escapeHtml(eventWhere(event.line, listingLines))}</span>`;
      return (
        `<li class="replay__event" data-kind="${event.kind}" data-step="${index}"${line}>` +
        `<span class="replay__role">${escapeHtml(event.role)}</span>` +
        `<p class="replay__body">${escapeHtml(event.body)}${where}</p></li>`
      );
    })
    .join("");
  const titleId = `${id}-title`;
  const listingAttribute = listing === undefined ? "" : ` data-listing="${escapeHtml(listing)}"`;
  return (
    `<section class="replay panel" id="${escapeHtml(id)}" aria-labelledby="${escapeHtml(titleId)}" ` +
    `data-steps="cumulative" data-step-unit="Event"${listingAttribute}>` +
    `<header class="replay__header">` +
    `<span class="label panel__label" id="${escapeHtml(titleId)}">${escapeHtml(title)}</span>` +
    `<span class="label panel__label replay__source">${breakAtSlashes(source)}</span></header>` +
    // The events scroll inside the panel once they outgrow it, so the list takes keyboard focus and has a name.
    `<div class="replay__scroll" tabindex="0" role="group" aria-label="${escapeHtml(`Events of ${title}`)}" ` +
    `data-step-scroll><ol class="replay__events">${items}</ol></div>` +
    stepControlsHtml(controlsLabel ?? `Replay of ${title}`, true) +
    "</section>"
  );
}
