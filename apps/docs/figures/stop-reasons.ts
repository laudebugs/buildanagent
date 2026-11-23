// The nine stop reasons of a run (packages/sdk/src/loop.ts, `Outcome`), in four groups by what ended the run. `done`
// is the model's own answer. A step limit, the budget, the progress policy and a stop hook end a run that would have
// gone on. A failed call, a failed hook or an unpriceable budget end it `error`, and the caller's abort ends it
// `aborted`. A call that waits for a person ends it `awaiting_approval` or, for a question, `clarification_requested`.
// Drawn 320 wide so it fits a 390 px phone whole.
import { Figure, type Rect } from "@buildanagent/manual/figures/svgkit";

const GROUP = { x: 8, width: 100 };
const REASONS = { x: 124, width: 188 };
const ROWS = [
  { y: 16, height: 40, group: ["finished"], reasons: ["done"], tone: "accent" },
  {
    y: 76,
    height: 56,
    group: ["stopped by", "a limit", "or a hook"],
    reasons: ["max_steps, budget,", "no_progress, stopped"],
  },
  { y: 152, height: 56, group: ["failed or", "aborted"], reasons: ["error, aborted"] },
  {
    y: 228,
    height: 56,
    group: ["paused for", "a person"],
    reasons: ["awaiting_approval,", "clarification_requested"],
  },
] as const;

export default function draw(): Figure {
  const figure = new Figure({ id: "stop-reasons", width: 320, height: 300 });
  for (const row of ROWS) {
    const rect = (place: { x: number; width: number }): Rect => ({ ...place, y: row.y, height: row.height });
    const tone = "tone" in row ? row.tone : "text";
    const group = figure.box(rect(GROUP), { label: row.group, tone });
    const reasons = figure.box(rect(REASONS), { label: row.reasons, tone });
    figure.connect(group, reasons, { tone });
  }
  return figure;
}
