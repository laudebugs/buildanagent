// Every string the landing page shows. Each factual sentence has a row in
// docs/plans/reviews/fact-check-landing-page.md; change both together.
/** The repository, which the GitHub link and the footer licence link share. */
export const repository = "https://github.com/laudebugs/buildanagent";

const docs = "https://docs.buildanagent.fyi";

export const copy = {
  brand: "Build An Agent",
  nav: [
    { label: "Docs", href: "https://docs.buildanagent.fyi" },
    { label: "Manual", href: "https://manual.buildanagent.fyi" },
    { label: "Site", href: "/" },
    { label: "GitHub", href: repository },
  ],
  hero: {
    eyebrow: "Agent toolkit · alpha",
    headlineBefore: "An agent is three layers.",
    headlineEmphasis: "See how each one works.",
    lead: "Build An Agent names them the gateway, the loop and the harness. Each is a small TypeScript package, and the manual explains the ideas behind each one.",
    primary: { label: "Read the docs", href: "https://docs.buildanagent.fyi" },
    secondary: { label: "Open the manual", href: "https://manual.buildanagent.fyi" },
    install: {
      label: "Install the alpha",
      command: "pnpm add @buildanagent/sdk@alpha @buildanagent/gateway@alpha",
    },
  },
  figure: {
    alt: "The three layers, from top to bottom: harness, loop and gateway, with what each does. One turn of the loop: a model call, then tool calls, then results returned to the model.",
    caption: "Figure 1. The three layers, and one turn of the loop.",
    labels: {
      harness: "harness",
      loop: "loop (sdk)",
      gateway: "gateway",
      harnessNote: "tools · sessions · MCP · approvals",
      loopNote: "model call, tool calls, stop",
      gatewayNote: "streaming · retries · caching · cost",
      modelCall: "model call",
      toolCalls: "tool calls",
      results: "results return to the model",
    },
  },
  cells: [
    {
      label: "Gateway",
      heading: "Calls models the same way",
      body: "The gateway streams replies, retries failed requests, sets prompt caching and puts a cost on every message.",
    },
    {
      label: "Loop",
      heading: "Runs turns you can follow",
      body: "The loop calls the model, runs its tools and stops on a condition you set, such as a step limit or a USD budget.",
    },
    {
      label: "Harness",
      heading: "Asks before it acts",
      body: "The harness keeps the session log, runs tools and holds a call that needs a person until a signed approval answers it.",
    },
  ],
  packages: {
    heading: "Six packages, one job each",
    items: [
      { name: "@buildanagent/gateway", summary: "Calls models and prices each call.", href: "/packages/gateway/" },
      { name: "@buildanagent/sdk", summary: "Runs the loop.", href: "/packages/sdk/" },
      {
        name: "@buildanagent/harness",
        summary: "Keeps sessions and runs tools.",
        href: `${docs}/reference/harness/`,
      },
      {
        name: "@buildanagent/agent-safety",
        summary: "Types write outcomes, signs approvals and caps spend.",
        href: `${docs}/reference/agent-safety/`,
      },
      {
        name: "@buildanagent/protocol",
        summary: "Defines the session log and client messages.",
        href: `${docs}/reference/protocol/`,
      },
      {
        name: "@buildanagent/cli",
        summary: "Runs the harness in a terminal.",
        href: `${docs}/reference/cli/`,
      },
    ],
  },
  footer: ["Every release is an alpha. Install it with the alpha tag.", "Source is on GitHub."],
} as const;
