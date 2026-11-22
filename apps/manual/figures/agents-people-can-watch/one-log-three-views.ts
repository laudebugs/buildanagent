// This chapter's flat figure of one event log feeding three views: a chat view, a plan view and a review view. Each view
// is a projection of the same ordered log, so the three agree by construction, and an approval made in one view goes
// back into the log as an entry.
import { Figure } from "../lib/svgkit.js";

const VIEWS = [
  { name: "chat view", note: "messages and tool cards" },
  { name: "plan view", note: "steps and their status" },
  { name: "review view", note: "what changed, to keep or undo" },
] as const;

export default function draw(): Figure {
  const figure = new Figure({ id: "one-log-three-views", width: 520, height: 250 });

  const log = figure.box(
    { x: 10, y: 80, width: 170, height: 70 },
    { label: ["one event log", "ordered, appended"], tone: "accent" },
  );

  for (const [index, view] of VIEWS.entries()) {
    const y = 20 + index * 72;
    const box = figure.box({ x: 290, y, width: 220, height: 40 }, { label: view.name });
    figure.arrow({ x: log.x + log.width, y: 115 }, { x: box.x, y: y + 20 });
    figure.text({ x: 400, y: y + 58 }, view.note, { tone: "muted" });
  }

  figure.text({ x: 260, y: 240 }, "three views, one record: an approval goes back in as an entry", { tone: "accent" });

  return figure;
}
