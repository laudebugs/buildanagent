// The retrieval chapter's figure for a memory record's life, from T43's example and our harness plan: written with its
// source and expiry, recalled with its source, checked against the source before an action, dropped and deleted by
// the recall tool after the expiry, while the session log keeps the write until the harness purges it.
import { Figure } from "../lib/svgkit.js";

export default function draw(): Figure {
  const figure = new Figure({ id: "memory-lifecycle", width: 520, height: 322 });

  figure.group("record", () => {
    const write = figure.box(
      { x: 10, y: 10, width: 300, height: 56 },
      { label: ["1. remember", "fact, source, created, expires"] },
    );
    const recall = figure.box(
      { x: 10, y: 92, width: 300, height: 56 },
      { label: ["2. recall before the expiry", "the record returns with its source"] },
    );
    const check = figure.box(
      { x: 10, y: 174, width: 300, height: 56 },
      { tone: "accent", label: ["3. check the source before acting", "agrees: renew; differs: rewrite"] },
    );
    const expire = figure.box(
      { x: 10, y: 256, width: 300, height: 56 },
      { label: ["4. recall after the expiry", "the tool deletes it, returns nothing"] },
    );
    figure.connect(write, recall);
    figure.connect(recall, check);
    figure.connect(check, expire);
  });

  figure.group("log", () => {
    figure.box(
      { x: 350, y: 10, width: 160, height: 92 },
      { tone: "muted", dashed: true, label: ["session log", "the write's tool", "call still holds", "the fact"] },
    );
    figure.arrow({ x: 310, y: 38 }, { x: 350, y: 38 }, { tone: "muted", dashed: true });
    figure.text({ x: 430, y: 124 }, "only the harness", { tone: "muted" });
    figure.text({ x: 430, y: 142 }, "can purge it", { tone: "muted" });
  });

  return figure;
}
