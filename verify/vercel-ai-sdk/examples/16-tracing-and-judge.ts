// A run's OpenTelemetry spans, kept in memory, and the grading code that scores its answer. The OpenTelemetry
// integration from @ai-sdk/otel turns a tool loop into one tree of spans: an agent span, a span for each step, and a
// span for each model call and tool call, with the token counts on the model calls and the agent span. An in-memory
// exporter holds them, so the example reads the tree back and needs no collector.
// The judge is scripted, so the example tests the grading code, not a model's judgement. A second scripted model
// answers with a score from 0 to 1 and a pass or fail grade, and the grading code parses the answer, rejects output
// that is malformed or contradicts itself, and never passes it through as a grade.
// Docs: ai-sdk-core/telemetry.mdx, ai-sdk-core/generating-text.mdx
import { OpenTelemetry } from "@ai-sdk/otel";
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { generateText, isStepCount, tool } from "ai";
import { z } from "zod";
import { check, scripted, systemText } from "./lib/check.ts";
import { usageOf } from "./lib/rates.ts";

// #region tracing
const exporter = new InMemorySpanExporter();
const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });

const answer = "Order 42 shipped on 3 November.";
const { model: agentModel } = scripted([{ tools: [{ name: "lookupOrder", input: { id: 42 } }] }, answer], {
  usage: usageOf({ noCache: 100, cacheRead: 0, cacheWrite: 0, output: 20 }),
  modelId: "agent-model",
});
const lookupOrder = tool({
  description: "Find an order's status.",
  inputSchema: z.object({ id: z.number() }),
  execute: async () => "shipped 3 November",
});

const result = await generateText({
  model: agentModel,
  prompt: "Where is order 42?",
  tools: { lookupOrder },
  stopWhen: isStepCount(5),
  telemetry: { integrations: new OpenTelemetry({ tracer: provider.getTracer("example") }) }, // book:note integration
});
const spans = exporter.getFinishedSpans(); // book:note in-memory
// #endregion

const byName = (name: string) => spans.filter((s) => s.name === name);
const agentSpan = byName("invoke_agent agent-model")[0];
const steps = spans.filter((s) => s.name.startsWith("step "));
const calls = byName("chat agent-model");
const toolSpan = byName("execute_tool lookupOrder")[0];
const tokens = (s: { attributes: Record<string, unknown> } | undefined, kind: "input" | "output") =>
  s?.attributes[`gen_ai.usage.${kind}_tokens`];

check(result.text === answer, "the run itself still answers");
check(
  JSON.stringify(spans.map((s) => s.name).sort()) ===
    JSON.stringify([
      "chat agent-model",
      "chat agent-model",
      "execute_tool lookupOrder",
      "invoke_agent agent-model",
      "step 1",
      "step 2",
    ]),
  "one agent span, two steps, two model calls and one tool call, named for what they did",
);
check(agentSpan !== undefined && agentSpan.parentSpanContext === undefined, "the agent span is the root");
check(
  steps.length === 2 && steps.every((s) => s.parentSpanContext?.spanId === agentSpan?.spanContext().spanId),
  "each step is a child of the agent span",
);
check(
  calls.length === 2 && calls.every((c) => steps.some((s) => s.spanContext().spanId === c.parentSpanContext?.spanId)),
  "each model call is a child of a step",
);
check(
  toolSpan?.parentSpanContext?.spanId === steps.find((s) => s.name === "step 1")?.spanContext().spanId,
  "the tool call is a child of the step that asked for it",
);
check(toolSpan?.attributes["gen_ai.tool.name"] === "lookupOrder", "the tool span names the tool");
check(
  calls.every((c) => tokens(c, "input") === 100 && tokens(c, "output") === 20),
  "each model call carries its own token counts (100 in, 20 out)",
);
check(
  tokens(agentSpan, "input") === 200 && tokens(agentSpan, "output") === 40,
  "the agent span carries the total across both calls (200 in, 40 out)",
);
check(
  JSON.stringify(calls.map((c) => c.attributes["gen_ai.response.finish_reasons"])) ===
    JSON.stringify([["tool-calls"], ["stop"]]),
  "the first model call ended asking for a tool and the second ended with an answer",
);

// #region judge
const PASS_MARK = 0.7;
const Verdict = z.object({
  score: z.number().min(0).max(1),
  grade: z.enum(["pass", "fail"]),
  reason: z.string().min(1),
});
type Verdict = z.infer<typeof Verdict>;

class JudgeOutputError extends Error {}

/** Parses the judge's text into a verdict, or throws: output that is not JSON, out of range or self-contradicting. */
function parseVerdict(text: string): Verdict {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new JudgeOutputError("the judge did not answer with JSON");
  }
  const parsed = Verdict.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new JudgeOutputError(`the verdict is malformed at ${issue?.path.join(".")}: ${issue?.message}`);
  }
  if (parsed.data.score >= PASS_MARK !== (parsed.data.grade === "pass")) {
    throw new JudgeOutputError(`the grade ${parsed.data.grade} contradicts the score ${parsed.data.score}`);
  }
  return parsed.data;
}

const RUBRIC = `Grade the answer from 0 to 1. Pass it at ${PASS_MARK} or above. Reply with JSON: score, grade, reason.`;
async function grade(judge: Parameters<typeof generateText>[0]["model"], question: string, reply: string) {
  const { text } = await generateText({
    model: judge,
    system: RUBRIC,
    prompt: `Question: ${question}\nAnswer: ${reply}`,
  });
  return parseVerdict(text); // book:note parse
}
// #endregion

const verdicts = [
  '{"score":0.9,"grade":"pass","reason":"names the order and the date"}',
  '{"score":0.3,"grade":"fail","reason":"does not say when"}',
  '{"score":0.7,"grade":"pass","reason":"exactly at the pass mark"}',
];
const malformed = [
  ["not JSON", "Looks good to me!", "the judge did not answer with JSON"],
  ["a score above 1", '{"score":1.4,"grade":"pass","reason":"great"}', "the verdict is malformed at score"],
  [
    "a grade that is not pass or fail",
    '{"score":0.8,"grade":"maybe","reason":"unsure"}',
    "the verdict is malformed at grade",
  ],
  ["a missing reason", '{"score":0.8,"grade":"pass"}', "the verdict is malformed at reason"],
  ["a pass below the mark", '{"score":0.4,"grade":"pass","reason":"fine"}', "the grade pass contradicts the score 0.4"],
  ["a fail at the mark", '{"score":0.7,"grade":"fail","reason":"harsh"}', "the grade fail contradicts the score 0.7"],
] as const;
const { model: judge, requests } = scripted([...verdicts, ...malformed.map(([, text]) => text)], {
  modelId: "judge-model",
});

const passed = await grade(judge, "Where is order 42?", answer);
check(passed.score === 0.9 && passed.grade === "pass", "a well-formed pass is parsed into its score and grade");
check(passed.reason.length > 0, "the verdict keeps the judge's reason");
const failed = await grade(judge, "Where is order 42?", "Probably somewhere.");
check(failed.score === 0.3 && failed.grade === "fail", "a well-formed fail is parsed too");
const atMark = await grade(judge, "Where is order 42?", answer);
check(atMark.score === 0.7 && atMark.grade === "pass", "a score exactly at the pass mark passes");

check(systemText(requests[0]).includes(RUBRIC), "the judge receives the rubric as its instructions");
check(JSON.stringify(requests[0].prompt).includes(answer), "and the answer it grades");

for (const [defect, , message] of malformed) {
  const error = await grade(judge, "Where is order 42?", answer).catch((e: unknown) => e);
  check(
    error instanceof JudgeOutputError && error.message.startsWith(message),
    `the judge's output is rejected for ${defect}`,
  );
}
check(requests.length === verdicts.length + malformed.length, "every scripted judge answer was used");
