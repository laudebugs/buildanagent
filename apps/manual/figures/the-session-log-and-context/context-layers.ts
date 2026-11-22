// The session-log chapter's figure of the five context layers, cheapest first, as the harness plan describes them
// (HD3): what each one does and what it leaves in the log. The layers are a design, not shipped code, as of November
// 2026, and the chapter says so beside the figure.
import { Figure } from "../lib/svgkit.js";

const LAYERS = [
  { name: ["1 write cap"], does: ["cap a tool result at 64 KiB,", "spill the rest to a file"], log: ["capped result", "and a file path"] },
  { name: ["2 mask"], does: ["show older tool results as", "500 characters, in steps"], log: ["nothing:", "a read-time view"] },
  { name: ["3 summarize"], does: ["between turns: replace old", "messages with a summary"], log: ["one compaction", "entry"] },
  { name: ["4 mid-turn"], does: ["the same, when one step", "reaches 90% of the window"], log: ["one compaction", "entry"] },
  { name: ["5 overflow", "retry"], does: ["on a provider overflow error:", "compact once, then retry"], log: ["one compaction", "entry"] },
] as const;

export default function draw(): Figure {
  const figure = new Figure({ id: "context-layers", width: 520, height: 328 });
  const columns = [
    { x: 4, width: 112, title: "layer" },
    { x: 122, width: 250, title: "what it does" },
    { x: 378, width: 138, title: "what the log gets" },
  ] as const;

  figure.group("headings", () => {
    for (const column of columns) figure.text({ x: column.x, y: 14 }, column.title, { anchor: "start", tone: "muted" });
  });

  for (const [index, layer] of LAYERS.entries()) {
    const y = 24 + index * 58;
    // The first two layers change what the model reads and add little to the log; the last three add a summary entry.
    const tone = index < 2 ? "text" : "accent";
    figure.group(`layer-${index + 1}`, () => {
      figure.box({ x: columns[0].x, y, width: columns[0].width, height: 50 }, { label: layer.name, tone });
      figure.box({ x: columns[1].x, y, width: columns[1].width, height: 50 }, { label: layer.does });
      figure.box({ x: columns[2].x, y, width: columns[2].width, height: 50 }, { label: layer.log, tone: "muted" });
    });
  }

  figure.text({ x: 4, y: 322 }, "cheapest first, from the top down", { anchor: "start", tone: "muted" });

  return figure;
}
