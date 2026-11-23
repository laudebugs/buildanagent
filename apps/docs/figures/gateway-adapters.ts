// The gateway's adapters (packages/gateway/README.md, "A model is an adapter object plus a model id"). `createModel()`
// binds one adapter object to one model id, and the model streams every call through the gateway's retries, caching
// and cost accounting. The Anthropic adapter speaks the Messages API, the OpenAI-compatible adapter speaks Chat
// Completions, and a scripted adapter plays answers from memory, so it sends no request. Drawn 320 wide so it fits a
// 390 px phone whole.
import { Figure, type Rect } from "@buildanagent/manual/figures/svgkit";

const COLUMN = 96;
const XS = [8, 112, 216] as const;
const adapterBox = (x: number, y: number, height: number): Rect => ({ x, y, width: COLUMN, height });

export default function draw(): Figure {
  const figure = new Figure({ id: "gateway-adapters", width: 320, height: 316 });

  const code = figure.box({ x: 8, y: 16, width: 304, height: 36 }, { label: "your code" });
  const gateway = figure.box(
    { x: 8, y: 88, width: 304, height: 64 },
    { label: ["gateway", "streaming, retries,", "caching, cost"], tone: "accent" },
  );
  figure.connect(code, gateway);

  const names = ["anthropic", "openai-chat", "scripted"] as const;
  const adapters = names.map((name, index) => {
    const rect = figure.box(adapterBox(XS[index] ?? 0, 188, 36), { label: name });
    figure.connect(gateway, rect);
    return rect;
  });

  const apis = [
    ["Messages", "API"],
    ["Chat", "Completions"],
    ["no", "request"],
  ] as const;
  apis.forEach((label, index) => {
    const adapter = adapters[index];
    if (adapter === undefined) return;
    const target = figure.box(adapterBox(adapter.x, 260, 48), { label, tone: "muted", dashed: true });
    figure.connect(adapter, target, { tone: "muted", dashed: true });
  });
  return figure;
}
