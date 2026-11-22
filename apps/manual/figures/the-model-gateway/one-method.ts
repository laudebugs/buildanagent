// The model gateway chapter's figure of one gateway method under two wire protocols: the loop calls one stream method,
// the gateway retries and prices around it, and each adapter turns the call into its provider's request. The paths
// are the ones packages/gateway's adapters post to.
import { Figure } from "../lib/svgkit.js";

export default function draw(): Figure {
  const figure = new Figure({ id: "one-method", width: 520, height: 270 });

  const loop = figure.box({ x: 10, y: 100, width: 100, height: 56 }, { label: ["agent loop"] });
  const gateway = figure.box(
    { x: 150, y: 70, width: 150, height: 116 },
    { label: ["gateway", "stream()", "retries, cost"], tone: "accent" },
  );
  const anthropic = figure.box(
    { x: 335, y: 30, width: 180, height: 56 },
    { label: ["Anthropic adapter", "POST /v1/messages"] },
  );
  const openai = figure.box(
    { x: 335, y: 170, width: 180, height: 56 },
    { label: ["OpenAI adapter", "POST /chat/completions"] },
  );

  figure.group("calls", () => {
    figure.connect(loop, gateway);
    figure.connect(gateway, anthropic);
    figure.connect(gateway, openai);
  });

  figure.group("notes", () => {
    figure.text({ x: 130, y: 250 }, "one method in", { tone: "muted" });
    figure.text({ x: 425, y: 250 }, "one wire format each", { tone: "muted" });
  });

  return figure;
}
