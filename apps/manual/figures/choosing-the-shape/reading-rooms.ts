// Chapter 17's analogy illustration for subagents: researchers sent to separate reading rooms read their sources there
// and return with a summary, so the lead sees the question and the summaries and never the sources. Each researcher is
// paid by the word read, which is where the analogy breaks: the tokens of every room add to the bill. The register's
// reading-rooms entry names it.
import { Figure, type Rect } from "../lib/svgkit.js";

const ROOM = { x: 250, width: 260, height: 96 };

/** One reading room: a frame, a researcher and two sources, with its top edge at `top`. */
function room(figure: Figure, top: number, title: string, sources: readonly [string, string]): void {
  figure.text({ x: ROOM.x + ROOM.width / 2, y: top - 10 }, title, { tone: "muted" });
  figure.box({ x: ROOM.x, y: top, width: ROOM.width, height: ROOM.height }, { dashed: true });
  figure.box({ x: ROOM.x + 12, y: top + 30, width: 96, height: 36 }, { label: "researcher", tone: "accent" });
  figure.box({ x: ROOM.x + 128, y: top + 10, width: 120, height: 32 }, { label: sources[0] });
  figure.box({ x: ROOM.x + 128, y: top + 54, width: 120, height: 32 }, { label: sources[1] });
}

export default function draw(): Figure {
  const figure = new Figure({ id: "reading-rooms", width: 520, height: 300 });
  const lead: Rect = { x: 10, y: 123, width: 140, height: 40 };

  figure.group("lead", () => {
    figure.box(lead, { label: "lead agent" });
    figure.text({ x: 80, y: 186 }, "reads summaries,", { tone: "muted" });
    figure.text({ x: 80, y: 204 }, "never the sources", { tone: "muted" });
  });

  figure.group("rooms", () => {
    room(figure, 34, "reading room 1", ["source A", "source B"]);
    room(figure, 160, "reading room 2", ["source C", "source D"]);
  });

  figure.group("traffic", () => {
    figure.arrow({ x: 150, y: 131 }, { x: 250, y: 86 });
    figure.arrow({ x: 150, y: 155 }, { x: 250, y: 212 });
    figure.arrow({ x: 250, y: 102 }, { x: 150, y: 139 }, { tone: "accent", dashed: true });
    figure.arrow({ x: 250, y: 196 }, { x: 150, y: 147 }, { tone: "accent", dashed: true });
  });

  figure.text({ x: 260, y: 284 }, "each researcher is paid by the word read", { tone: "accent" });

  return figure;
}
