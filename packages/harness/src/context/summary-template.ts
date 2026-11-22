/**
 * The summary request: a recall-first template with fixed sections, and a rule to keep exact identifiers. The sections
 * and the rule follow Pi's compaction prompt (MIT, `@earendil-works/pi-coding-agent` 1.5.2); the version names this
 * wording, so an entry says which template wrote its summary and a change to the wording is a new version.
 */
import type { Message, ModelContent } from "@buildanagent/gateway";

/** The version of the template below. Stored on each `compaction` entry as `promptVersion`. */
export const SUMMARY_PROMPT_VERSION = "recall-v1";

/** The system prompt of the summary call. */
export const SUMMARY_SYSTEM = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;

const SECTIONS = `## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]`;

const text = (blocks: readonly ModelContent[]): string =>
  blocks.map((block) => (block.type === "text" ? block.text : "[image]")).join("\n");

const cut = (value: string, chars: number): string =>
  value.length <= chars ? value : `${value.slice(0, chars)} [... ${value.length - chars} more characters cut]`;

/** One message as the summary call reads it: a labelled line, with a tool result cut to `toolOutputChars`. */
function render(message: Message, toolOutputChars: number): string {
  if (message.role === "user")
    return `[User]: ${message.content.map((b) => (b.type === "text" ? b.text : "[image]")).join("\n")}`;
  if (message.role === "tool")
    return `[Tool result${message.isError ? " (error)" : ""}]: ${cut(text(message.content), toolOutputChars)}`;
  const parts = message.content.flatMap((block) => {
    if (block.type === "text") return [`[Assistant]: ${block.text}`];
    if (block.type === "tool_call") return [`[Assistant tool call]: ${block.name}(${JSON.stringify(block.input)})`];
    return [];
  });
  return parts.join("\n\n");
}

/** The summary call's user message: the whole span, then the format, then an optional focus. */
export function summaryPrompt(
  span: readonly Message[],
  options: { toolOutputChars: number; focus?: string | undefined },
): string {
  const conversation = span
    .map((message) => render(message, options.toolOutputChars))
    .filter((line) => line !== "")
    .join("\n\n");
  const focus = options.focus === undefined ? "" : `\n\nPay particular attention to: ${options.focus}`;
  return `<conversation>
${conversation}
</conversation>

The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

${SECTIONS}

Keep each section concise. Preserve exact file paths, function names, and error messages.${focus}`;
}
