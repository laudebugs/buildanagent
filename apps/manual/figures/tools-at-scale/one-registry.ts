// Chapter 13's registry: tools of three sources enter one registry, which names each once, sets whether a request
// carries its definition and marks how far its output is trusted; the permission pipeline then decides every call
// from that one description. It draws the design of our harness's registry, not an SDK's.
import { Figure } from "../lib/svgkit.js";

export default function draw(): Figure {
  const figure = new Figure({ id: "one-registry", width: 520, height: 236 });

  figure.group("sources", () => {
    figure.text({ x: 65, y: 14 }, "three sources", { tone: "muted" });
    const builtin = figure.box({ x: 10, y: 28, width: 110, height: 40 }, { label: ["built-in", "tools"] });
    const mcp = figure.box({ x: 10, y: 98, width: 110, height: 40 }, { label: ["MCP server", "tools"] });
    const extension = figure.box({ x: 10, y: 168, width: 110, height: 40 }, { label: ["extension", "tools"] });
    figure.arrow({ x: builtin.x + builtin.width, y: 48 }, { x: 170, y: 48 });
    figure.arrow({ x: mcp.x + mcp.width, y: 118 }, { x: 170, y: 118 });
    figure.arrow({ x: extension.x + extension.width, y: 188 }, { x: 170, y: 188 });
  });

  figure.group("registry", () => {
    figure.text({ x: 245, y: 14 }, "one registry", { tone: "muted" });
    figure.box({ x: 170, y: 22, width: 150, height: 196 }, { tone: "accent" });
    figure.box({ x: 178, y: 30, width: 134, height: 58 }, { label: ["names it once:", "mcp__github__x"] });
    figure.box(
      { x: 178, y: 92, width: 134, height: 58 },
      { label: ["sets exposure:", "direct, deferred", "or hidden"] },
    );
    figure.box({ x: 178, y: 154, width: 134, height: 58 }, { label: ["marks trust:", "MCP output is", "untrusted"] });
  });

  figure.group("uses", () => {
    figure.text({ x: 445, y: 14 }, "what reads it", { tone: "muted" });
    const request = figure.box(
      { x: 370, y: 28, width: 140, height: 70 },
      { label: ["each request:", "direct tools plus", "tool_search"] },
    );
    const pipeline = figure.box(
      { x: 370, y: 128, width: 140, height: 70 },
      { label: ["permission", "pipeline: every", "call is decided"], tone: "accent" },
    );
    figure.arrow({ x: 320, y: 63 }, { x: request.x, y: 63 });
    figure.arrow({ x: 320, y: 163 }, { x: pipeline.x, y: 163 });
  });

  return figure;
}
