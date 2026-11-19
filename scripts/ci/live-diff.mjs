// Compares the flow of each live transcript (verify/<sdk>/results/live/<example>.json) with its mock transcript
// (results/transcripts/<example>.json), for the examples in apps/manual/src/data/live-examples.json. A flow is three
// things: the sequence of tool calls, each by name and argument keys; the stop reason, the finish of the last answer;
// and the result of each check(). Text, argument values, ids and timing are ignored, because a real model words its
// answers differently on every run.
//
//   node scripts/ci/live-diff.mjs [--config <file>] [--live-dir <dir>] [--report <live-report.json>] [--json <file>]
//
// Prints the differences as Markdown, for the issue live-run.yml opens, and with --json writes them as data. A
// difference is a prompt to look, not a failure: the script exits 0 whatever it finds, and 1 only when it can't run.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { exampleOf, LIVE_EXAMPLES_FILE, REPO_ROOT, readLiveConfig } from "../live/config.mjs";

/** One tool call as the flow sees it: its name and its argument keys, sorted. */
const callOf = (part) => {
  const keys =
    part.input && typeof part.input === "object" && !Array.isArray(part.input) ? Object.keys(part.input) : [];
  return `${part.name}(${keys.sort().join(", ")})`;
};

/**
 * A transcript's flow. Calls that one answer makes together have no order of their own, so they are sorted; answers
 * keep their order.
 */
export function flowOf(transcript) {
  const responses = transcript.events.filter((event) => event.kind === "response");
  return {
    calls: responses.flatMap((event) =>
      event.message.parts
        .filter((part) => part.type === "tool-call")
        .map(callOf)
        .sort(),
    ),
    stop: responses.at(-1)?.finish ?? null,
    checks: transcript.events.filter((event) => event.kind === "check").map(({ message, pass }) => ({ message, pass })),
  };
}

const list = (calls) => (calls.length === 0 ? "no tool calls" : calls.map((call) => `\`${call}\``).join(", "));

/** The differences between two flows, each a sentence; an empty list means the flows match. */
export function compareFlows(mock, live) {
  const differences = [];
  if (JSON.stringify(mock.calls) !== JSON.stringify(live.calls)) {
    differences.push(`Tool calls changed: the mock made ${list(mock.calls)}; the live run made ${list(live.calls)}.`);
  }
  if (mock.stop !== live.stop) {
    differences.push(`Stop reason changed: the mock ended with \`${mock.stop}\`; the live run with \`${live.stop}\`.`);
  }
  const liveChecks = new Map(live.checks.map((check) => [check.message, check.pass]));
  for (const check of mock.checks) {
    const pass = liveChecks.get(check.message);
    if (pass === undefined) differences.push(`Check "${check.message}" did not run live.`);
    else if (pass !== check.pass) {
      differences.push(
        `Check "${check.message}" ${pass ? "passed" : "failed"} live; it ${check.pass ? "passes" : "fails"} against the mock.`,
      );
    }
  }
  const mockMessages = new Set(mock.checks.map((check) => check.message));
  for (const check of live.checks) {
    if (!mockMessages.has(check.message)) {
      differences.push(
        `Check "${check.message}" ran live (${check.pass ? "passed" : "failed"}) but not against the mock.`,
      );
    }
  }
  return differences;
}

/** Compares every listed example; an example without a live transcript counts as one difference. */
export function compareAll(config, { root = REPO_ROOT, liveDir } = {}) {
  return config.examples.map((example) => {
    const { harness, id, mock, live } = exampleOf(example.file);
    const liveFile = liveDir === undefined ? join(root, live) : join(liveDir, harness, `${id}.json`);
    const mockFile = join(root, mock);
    const base = { file: example.file, provider: example.provider, model: example.model };
    if (!existsSync(mockFile)) return { ...base, differences: [`No mock transcript at \`${mock}\`.`] };
    if (!existsSync(liveFile))
      return { ...base, differences: ["No live transcript: the example recorded no live run."] };
    const read = (file) => flowOf(JSON.parse(readFileSync(file, "utf8")));
    return { ...base, differences: compareFlows(read(mockFile), read(liveFile)) };
  });
}

/** The comparison as Markdown, with the run's outcome per example when the run's report is given. */
export function diffMarkdown(results, report) {
  const outcomes = new Map((report?.examples ?? []).map((e) => [e.file, e.outcome]));
  const differing = results.filter((r) => r.differences.length > 0);
  const lines = [
    differing.length === 0
      ? `All ${results.length} live examples kept the mock's flow: the same tool calls, stop reason and check results.`
      : `${differing.length} of ${results.length} live examples differ in flow from their mock transcripts. A ` +
        "real model varies between runs, so a difference is a prompt to look, not proof that the mock is wrong.",
  ];
  for (const result of differing) {
    const outcome = outcomes.get(result.file);
    lines.push(
      "",
      `### \`${result.file}\``,
      "",
      `${result.provider} \`${result.model}\`${outcome === undefined ? "" : `, outcome: ${outcome}`}`,
      "",
    );
    for (const difference of result.differences) lines.push(`- ${difference}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const { values } = parseArgs({
    options: {
      config: { type: "string", default: LIVE_EXAMPLES_FILE },
      "live-dir": { type: "string" },
      report: { type: "string" },
      json: { type: "string" },
    },
  });
  const results = compareAll(readLiveConfig(values.config), { liveDir: values["live-dir"] });
  const report =
    values.report && existsSync(values.report) ? JSON.parse(readFileSync(values.report, "utf8")) : undefined;
  if (values.json) {
    const differences = results.reduce((sum, r) => sum + r.differences.length, 0);
    writeFileSync(values.json, `${JSON.stringify({ differences, examples: results }, null, 2)}\n`);
  }
  process.stdout.write(diffMarkdown(results, report));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`live-diff: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
