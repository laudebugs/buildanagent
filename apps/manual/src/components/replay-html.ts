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
}

/**
 * A recorded run as a panel. Without JavaScript every event shows in order, as a numbered list; src/scripts/steps.ts
 * reveals them one by one with back, next, restart and play, and highlights the listing line an event names.
 */
export function replayHtml({ id, title, source, events, listing, controlsLabel }: ReplayOptions): string {
  const items = events
    .map((event, index) => {
      const line = event.line === undefined ? "" : ` data-line="${event.line}"`;
      return (
        `<li class="replay__event" data-kind="${event.kind}" data-step="${index}"${line}>` +
        `<span class="replay__role">${escapeHtml(event.role)}</span>` +
        `<p class="replay__body">${escapeHtml(event.body)}</p></li>`
      );
    })
    .join("");
  const titleId = `${id}-title`;
  const listingAttribute = listing === undefined ? "" : ` data-listing="${escapeHtml(listing)}"`;
  return (
    `<section class="replay panel" id="${escapeHtml(id)}" aria-labelledby="${escapeHtml(titleId)}" ` +
    `data-steps="cumulative" data-step-unit="Event"${listingAttribute}>` +
    `<header class="replay__header"><span class="label panel__label" id="${escapeHtml(titleId)}">${escapeHtml(title)}</span>` +
    `<span class="label panel__label">${escapeHtml(source)}</span></header>` +
    `<ol class="replay__events">${items}</ol>` +
    stepControlsHtml(controlsLabel ?? `Replay of ${title}`, true) +
    "</section>"
  );
}
