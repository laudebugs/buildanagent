// The model gateway chapter's analogy illustration for prompt caching: a printer that keeps the letterhead plate set
// between jobs. The register's letterhead-plate entry names it. The multipliers are Claude Sonnet 5.5's, as of
// November 2026: a five-minute cache write costs 1.25 times the base input price and a cache read 0.05 times.
import { Figure } from "../lib/svgkit.js";

const WIDTH = 150;
const XS = [10, 185, 360];

export default function draw(): Figure {
  const figure = new Figure({ id: "letterhead-plate", width: 520, height: 250 });

  const jobs = [
    ["job 1", "first request"],
    ["job 2", "same prefix"],
    ["job 3", "a tool moved"],
  ];
  const plates = [
    { label: ["plate set", "prefix written"], tone: "accent" as const, dashed: false },
    { label: ["plate reused", "prefix read"], tone: "accent" as const, dashed: false },
    { label: ["plate reset", "prefix rewritten"], tone: "muted" as const, dashed: true },
  ];
  const prices = ["write: 1.25x", "read: 0.05x", "write: 1.25x"];

  figure.group("jobs", () => {
    jobs.forEach((label, i) => {
      const job = figure.box({ x: XS[i] ?? 0, y: 20, width: WIDTH, height: 56 }, { label });
      const plate = figure.box(
        { x: XS[i] ?? 0, y: 120, width: WIDTH, height: 56 },
        { label: plates[i]?.label ?? [], tone: plates[i]?.tone ?? "text", dashed: plates[i]?.dashed ?? false },
      );
      figure.connect(job, plate);
      figure.text({ x: (XS[i] ?? 0) + WIDTH / 2, y: 210 }, prices[i] ?? "", { tone: i === 1 ? "accent" : "muted" });
    });
  });

  figure.group("caption", () => {
    figure.text({ x: 260, y: 240 }, "price of the prefix, against the base input rate", { tone: "muted" });
  });

  return figure;
}
