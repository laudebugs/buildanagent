// Chapter 6's analogy illustration for an approval: a bank's second signature on a large payment. The signature covers
// the payee and the amount as written, so a changed amount voids it, as a changed tool input voids a signed approval.
// The register's second-signature entry names it.
import { Figure } from "../lib/svgkit.js";

export default function draw(): Figure {
  const figure = new Figure({ id: "second-signature", width: 520, height: 270 });

  figure.group("payment", () => {
    figure.text({ x: 130, y: 18 }, "payment order", { tone: "muted" });
    figure.box({ x: 20, y: 28, width: 220, height: 130 });
    figure.box({ x: 34, y: 42, width: 192, height: 30 }, { label: "pay: Acme Ltd" });
    figure.box({ x: 34, y: 80, width: 192, height: 30 }, { label: "amount: 4,000" });
    figure.box({ x: 34, y: 118, width: 192, height: 30 }, { label: "signed: M. Okafor", tone: "accent" });
  });

  figure.group("run", () => {
    figure.text({ x: 390, y: 18 }, "approved tool call", { tone: "muted" });
    figure.box({ x: 280, y: 28, width: 220, height: 130 });
    figure.box({ x: 294, y: 42, width: 192, height: 30 }, { label: "tool: issue_refund" });
    figure.box({ x: 294, y: 80, width: 192, height: 30 }, { label: "orderId: A-1" });
    figure.box({ x: 294, y: 118, width: 192, height: 30 }, { label: "signature: HMAC", tone: "accent" });
  });

  figure.text({ x: 260, y: 100 }, "like", { tone: "muted" });

  figure.group("edit", () => {
    figure.text({ x: 130, y: 190 }, "amount changed to 40,000:", { tone: "muted" });
    figure.text({ x: 130, y: 208 }, "the teller refuses it", { tone: "muted" });
    figure.text({ x: 390, y: 190 }, "orderId changed to Z-9:", { tone: "muted" });
    figure.text({ x: 390, y: 208 }, "the signature no longer matches", { tone: "muted" });
  });

  figure.text({ x: 260, y: 246 }, "the signature covers exactly what will run", { tone: "accent" });

  return figure;
}
