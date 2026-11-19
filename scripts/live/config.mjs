// The live run's example list, apps/manual/src/data/live-examples.json: which examples run against real APIs, on which
// provider and model, with what output allowance, and what a run is projected to cost. run.mjs runs the list,
// live-diff.mjs compares it, the book marks every other listing "verified against mock models only", and tests in
// scripts/ci/live-run.test.mjs and apps/manual check it with liveConfigProblems().
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CAP_USD, catalogEntry, projectCost, readCatalog, TARGET_USD } from "./budget.ts";

export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const LIVE_EXAMPLES_FILE = join(REPO_ROOT, "apps/manual/src/data/live-examples.json");

/** The environment secret that holds each provider's key, in the protected live-run environment. */
export const KEY_NAMES = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" };

/**
 * The providers each harness's pinned packages reach (book plan BK18). google-adk reaches neither: its pinned
 * TypeScript release has only the built-in Gemini model.
 */
export const PROVIDERS = {
  "verify/claude-agent-sdk": ["anthropic"],
  "verify/openai-agents-sdk": ["openai"],
  "verify/copilot-sdk": ["anthropic", "openai"],
  "verify/vercel-ai-sdk": ["anthropic", "openai"],
  "verify/cloudflare-agents": ["anthropic", "openai"],
  "verify/langchain": ["anthropic", "openai"],
  "verify/pi": ["anthropic", "openai"],
  "verify/google-adk": [],
};

/**
 * The harnesses whose scripts/run-examples.mjs has a --live mode. The Claude Agent SDK and Copilot SDK record no mock
 * transcript yet (T49), so a live run of theirs would have nothing to compare with.
 */
export const LIVE_HARNESSES = [
  "verify/vercel-ai-sdk",
  "verify/openai-agents-sdk",
  "verify/langchain",
  "verify/pi",
  "verify/cloudflare-agents",
];

/** An example's harness directory and name, from its path: `verify/pi/examples/08-triage-agent.ts`. */
export function exampleOf(file) {
  const harness = dirname(dirname(file));
  const id = basename(file, extname(file));
  return { harness, id, mock: `${harness}/results/transcripts/${id}.json`, live: `${harness}/results/live/${id}.json` };
}

export function readLiveConfig(file = LIVE_EXAMPLES_FILE) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * The projected cost of one run of the list: for each example, its `calls` at the most each can cost, every input
 * token of `inputTokensPerCall` at the dearest input rate and the whole `maxTokens` at the output rate. Each figure is
 * rounded up to a hundredth of a cent, so the recorded projection never undercounts.
 */
export function projection(config, catalog = readCatalog()) {
  // toFixed drops the float noise of a sum, such as 0.22070000000000003, before rounding up.
  const up = (value) => Math.ceil(Number((value * 10_000).toFixed(6))) / 10_000;
  const examples = {};
  let total = 0;
  for (const example of config.examples) {
    const entry = catalogEntry(catalog, example.provider, example.model);
    const perCall = projectCost(
      { inputTokens: config.projection.inputTokensPerCall, maxOutputTokens: example.maxTokens },
      entry,
    );
    const cost = perCall === null ? null : up(perCall * example.calls);
    examples[example.file] = cost;
    if (cost !== null) total += cost;
  }
  const asOf = [
    ...new Set(config.examples.map((e) => catalogEntry(catalog, e.provider, e.model)?.asOf).filter(Boolean)),
  ];
  return { examples, total: up(total), catalogAsOf: asOf.sort().at(-1) ?? null };
}

/**
 * The problems with the list, each a sentence; an empty list means the list is sound. run.mjs passes
 * `projection: false`, because the recorded projection documents the list rather than limiting a run, which the cost
 * guard does; the tests check it.
 */
export function liveConfigProblems(
  config,
  { root = REPO_ROOT, catalog = readCatalog(), projection: check = true } = {},
) {
  const problems = [];
  if (config.cap !== CAP_USD) problems.push(`cap is ${config.cap}, not the owner's $${CAP_USD}`);
  if (config.target !== TARGET_USD) problems.push(`target is ${config.target}, not the owner's $${TARGET_USD}`);
  if (!Array.isArray(config.examples) || config.examples.length === 0) {
    problems.push("examples must be a non-empty list");
    return problems;
  }
  const seen = new Set();
  for (const example of config.examples) {
    const where = example.file ?? "an example";
    const { harness, mock } = exampleOf(String(example.file ?? ""));
    if (seen.has(example.file)) problems.push(`${where} is listed twice`);
    seen.add(example.file);
    if (!existsSync(join(root, String(example.file ?? "")))) problems.push(`${where} does not exist`);
    if (!(harness in PROVIDERS)) problems.push(`${where} is in no harness`);
    else if (!PROVIDERS[harness].includes(example.provider)) {
      const reach = PROVIDERS[harness].join(" or ") || "no provider the run holds a key for";
      problems.push(`${where} runs on ${example.provider}, but ${harness}'s pinned packages reach ${reach}`);
    }
    if (!LIVE_HARNESSES.includes(harness)) problems.push(`${harness} has no live mode`);
    if (!existsSync(join(root, mock))) problems.push(`${where} has no mock transcript to compare with (${mock})`);
    if (!Number.isInteger(example.maxTokens) || example.maxTokens <= 0) {
      problems.push(`${where} needs a positive integer maxTokens`);
    }
    if (!Number.isInteger(example.calls) || example.calls <= 0) problems.push(`${where} needs a positive calls`);
    if (catalogEntry(catalog, example.provider, example.model) === undefined) {
      problems.push(`${where}'s model ${example.provider} ${example.model} is not in the price catalog`);
    }
  }
  if (problems.length > 0 || !check) return problems;
  const projected = projection(config, catalog);
  for (const [file, cost] of Object.entries(projected.examples)) {
    if (config.projection.examples?.[file] !== cost) {
      problems.push(
        `projection.examples["${file}"] is ${config.projection.examples?.[file]}, but the list projects ${cost}`,
      );
    }
  }
  if (config.projection.total !== projected.total) {
    problems.push(`projection.total is ${config.projection.total}, but the list projects ${projected.total}`);
  }
  if (config.projection.catalogAsOf !== projected.catalogAsOf) {
    problems.push(`projection.catalogAsOf is ${config.projection.catalogAsOf}, not ${projected.catalogAsOf}`);
  }
  if (projected.total >= TARGET_USD) {
    problems.push(`a run projects $${projected.total}, not under the $${TARGET_USD} target`);
  }
  return problems;
}
