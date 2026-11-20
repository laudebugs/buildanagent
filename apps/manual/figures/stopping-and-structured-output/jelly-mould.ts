// Chapter 4's analogy illustration for structured output: a jelly mould gives every jelly its shape, whatever the
// flavour. The three jellies are the answers of verify/vercel-ai-sdk/examples/05-structured-output.ts: the scripted
// "billing, urgent" answer, a "bug, not urgent" answer the same schema would accept, and the scripted "refund"
// answer that fails it. The register's jelly-mould entry names this figure.
import { Figure } from "../lib/svgkit.js";

export default function draw(): Figure {
  const figure = new Figure({ id: "jelly-mould", width: 520, height: 260 });

  const mould = figure.box(
    { x: 120, y: 16, width: 280, height: 56 },
    { label: ["the mould: the schema", "category, urgent: true or false"], tone: "accent" },
  );

  const jellies: readonly { x: number; label: string[]; note: [string, string]; dashed: boolean }[] = [
    { x: 20, label: ["billing", "urgent: true"], note: ["right shape,", "right answer"], dashed: false },
    { x: 185, label: ["bug", "urgent: false"], note: ["right shape,", "wrong answer"], dashed: false },
    { x: 350, label: ["refund", "no urgent field"], note: ["did not set:", "rejected"], dashed: true },
  ];

  figure.group("jellies", () => {
    for (const jelly of jellies) {
      const box = figure.box(
        { x: jelly.x, y: 130, width: 150, height: 56 },
        { label: jelly.label, dashed: jelly.dashed, tone: jelly.dashed ? "muted" : "text" },
      );
      figure.connect(mould, box, { tone: "muted", dashed: jelly.dashed });
      const [first, second] = jelly.note;
      figure.text({ x: jelly.x + 75, y: 208 }, first, { tone: "muted" });
      figure.text({ x: jelly.x + 75, y: 224 }, second, { tone: "muted" });
    }
  });

  figure.text({ x: 260, y: 250 }, 'the ticket: "I was charged twice!"', { tone: "text" });

  return figure;
}
