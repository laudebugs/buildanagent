// Chapter 5's figure of where each of the eight SDKs keeps a session by default, as of November 2026, sorted by what
// survives: process memory, the host's disk, or somewhere else. Each default comes from the pinned package or its docs,
// as the chapter's fact-check log records: @openai/agents 0.21.0, langchain 1.6.6, @google/adk 2.5.0,
// @anthropic-ai/claude-agent-sdk 0.3.327, @earendil-works/pi-coding-agent 1.5.2, @github/copilot-sdk 1.0.31,
// agents 0.33.0 and ai 7.0.162.
import { Figure } from "../lib/svgkit.js";

const WIDTH = 520;
const BOX_HEIGHT = 58;

export default function draw(): Figure {
  const figure = new Figure({ id: "state-places", width: WIDTH, height: 254 });

  const band = (
    name: string,
    y: number,
    label: string,
    boxes: readonly (readonly string[])[],
    tone: "text" | "accent",
  ) => {
    figure.group(name, () => {
      figure.text({ x: 6, y: y + 12 }, label, { anchor: "start", tone: "muted" });
      const gap = 6;
      const width = (WIDTH - 8 - gap * (boxes.length - 1)) / boxes.length;
      for (const [index, label] of boxes.entries()) {
        figure.box({ x: 4 + index * (width + gap), y: y + 20, width, height: BOX_HEIGHT }, { label, tone });
      }
    });
  };

  band(
    "memory",
    4,
    "in memory: lost when the process restarts",
    [
      ["OpenAI Agents SDK", "MemorySession"],
      ["LangChain", "MemorySaver"],
      ["Google ADK", "InMemorySession", "Service"],
    ],
    "text",
  );
  band(
    "disk",
    86,
    "on the host's disk: lost with the machine",
    [
      ["Claude Agent SDK", "~/.claude/projects"],
      ["Pi", "~/.pi/agent/sessions"],
      ["Copilot SDK", "~/.copilot"],
    ],
    "text",
  );
  band(
    "elsewhere",
    168,
    "elsewhere: as durable as that store",
    [
      ["Cloudflare Agents", "the agent's own SQLite"],
      ["Vercel AI SDK", "the messages you keep"],
    ],
    "accent",
  );

  return figure;
}
