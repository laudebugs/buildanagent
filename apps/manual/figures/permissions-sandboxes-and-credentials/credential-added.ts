// Chapter 22's flat figure of where the credential is added: the sandbox sends a placeholder, and the proxy on the host
// swaps in the real secret from a vault outside the sandbox on the way to the service.
import { Figure } from "../lib/svgkit.js";

export default function draw(): Figure {
  const figure = new Figure({ id: "credential-added", width: 520, height: 260 });

  figure.group("sandbox", () => {
    figure.text({ x: 91, y: 14 }, "sandbox", { tone: "muted" });
    figure.box({ x: 8, y: 24, width: 166, height: 160 });
    const tool = figure.box(
      { x: 16, y: 38, width: 150, height: 66 },
      { label: ["GET /github/user", "Authorization:", "Bearer <sentinel>"] },
    );
    figure.box(
      { x: 16, y: 128, width: 150, height: 48 },
      { label: ["no real secret", "in the sandbox"], tone: "accent" },
    );
    figure.arrow({ x: tool.x + tool.width, y: 71 }, { x: 202, y: 71 });
  });

  figure.group("host", () => {
    figure.text({ x: 277, y: 14 }, "host", { tone: "muted" });
    figure.box({ x: 194, y: 24, width: 166, height: 160 });
    figure.box(
      { x: 202, y: 38, width: 150, height: 66 },
      { label: ["egress proxy:", "checks route,", "method, sentinel"] },
    );
    figure.box({ x: 202, y: 128, width: 150, height: 48 }, { label: ["vault: the", "real token"], tone: "accent" });
    figure.arrow({ x: 277, y: 128 }, { x: 277, y: 104 });
    figure.arrow({ x: 360, y: 71 }, { x: 384, y: 71 });
  });

  figure.group("service", () => {
    figure.text({ x: 450, y: 14 }, "service", { tone: "muted" });
    figure.box({ x: 384, y: 38, width: 128, height: 66 }, { label: ["api.github.com", "receives the", "real token"] });
  });

  figure.text({ x: 260, y: 212 }, "anything not on the allowlist gets a 403 and a log record", { tone: "muted" });
  figure.text({ x: 260, y: 242 }, "the secret is added on the way out, never stored inside", { tone: "accent" });

  return figure;
}
