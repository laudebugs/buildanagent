import type { Outline } from "./book/outline-types.js";

/**
 * The book's outline, in reading order (book plan §4). The build numbers chapters from their position here, and
 * figures, listings and tables from the chapter's number and their order in the chapter, so moving a chapter here
 * renumbers it and everything in it. Slugs carry no numbers, so a move breaks no link (BK5).
 *
 * Each opening type is the one the plan assigns. `check:book` fails when two consecutive chapters share an opening
 * type, or when one type opens more than a quarter of the chapters, rounded up (BK22).
 */
export const outline: Outline = [
  {
    title: "Part I: Foundations",
    chapters: [
      {
        slug: "call-workflow-loop",
        title: "Use the least autonomy that works: a call, a workflow, then a loop",
        opening: "scenario",
      },
      {
        slug: "talking-to-a-model",
        title: "Talking to a model: messages, streams, tokens, instructions and model choice",
        opening: "code",
      },
      {
        slug: "tools",
        title: "Tools: schemas, validation, errors the model can read, and identity it cannot fake",
        opening: "incident",
      },
      {
        slug: "stopping-and-structured-output",
        title: "Stopping: caps, stop conditions and structured output",
        opening: "question",
      },
      {
        slug: "memory-and-sessions",
        title: "Memory within a task: sessions, threads and resuming",
        opening: "analogy",
      },
      {
        slug: "approvals-guardrails-and-injection",
        title: "Asking before acting: approvals, guardrails and prompt injection",
        opening: "fact",
      },
      {
        slug: "testing-offline-and-a-first-agent",
        title: "Testing offline, and a first complete agent",
        opening: "scenario",
      },
    ],
  },
  {
    title: "Part II: In depth",
    chapters: [
      {
        slug: "choosing-the-shape",
        title: "Choosing the shape: buy, adopt or build, how to plan, and when subagents pay",
        opening: "fact",
      },
      {
        slug: "the-model-gateway",
        title: "The model gateway: one streaming method, retries, prompt caching, reasoning replay and cost",
        opening: "code",
      },
      {
        slug: "events-and-hooks",
        title: "Events and hooks: one event union, interceptors and observers",
        opening: "question",
      },
      {
        slug: "the-session-log-and-context",
        title: "The session log and context policy",
        opening: "analogy",
      },
      {
        slug: "retrieval-and-long-term-memory",
        title: "Retrieval and long-term memory",
        opening: "scenario",
      },
      {
        slug: "tools-at-scale",
        title: "Tools at scale: the registry, deferred tools, MCP and skills",
        opening: "fact",
      },
      {
        slug: "permissions-sandboxes-and-credentials",
        title: "Permissions, sandboxes and credentials, and the lethal trifecta",
        opening: "incident",
      },
      {
        slug: "agents-people-can-watch",
        title: "Agents people can watch: UIs, browsers and taking over",
        opening: "question",
      },
      {
        slug: "side-effects-that-can-fail",
        title: "Side effects that can fail: outcomes, idempotency and plan approvals",
        opening: "incident",
      },
      {
        slug: "durable-and-portable-agents",
        title: "Durable and portable agents, and how work reaches them",
        opening: "code",
      },
      {
        slug: "evals-observability-and-release",
        title: "Evals, observability and release",
        opening: "analogy",
      },
    ],
  },
];
