// Chapter 25's flat figure of a run's spans projected from its session log: each span is computed from log entries,
// so the log stays the only record and telemetry is a view of it. The mapping is the harness's `projectSpans()`
// (packages/harness/src/telemetry/plan.ts); the session's root `invoke_agent` span opens at no one entry, so the
// first row shows the `turn` span a run's entries bound.
import { Figure } from "../lib/svgkit.js";

const ROWS = [
  { entry: "turn_start … turn_end", span: "turn" },
  { entry: "message_end + usage", span: "chat" },
  { entry: "tool_result", span: "execute_tool" },
  { entry: "approval_requested … resolved", span: "approval wait" },
] as const;

export default function draw(): Figure {
  const figure = new Figure({ id: "spans-from-log", width: 520, height: 250 });

  figure.text({ x: 130, y: 14 }, "session log entries", { tone: "muted" });
  figure.text({ x: 415, y: 14 }, "spans, projected", { tone: "accent" });

  for (const [index, row] of ROWS.entries()) {
    const y = 28 + index * 48;
    const entry = figure.box({ x: 10, y, width: 240, height: 34 }, { label: row.entry });
    const span = figure.box({ x: 320, y, width: 190, height: 34 }, { label: row.span, tone: "accent" });
    figure.arrow({ x: entry.x + entry.width, y: y + 17 }, { x: span.x, y: y + 17 });
  }

  figure.text({ x: 260, y: 236 }, "the log is the record; a span is a view of it", { tone: "accent" });

  return figure;
}
