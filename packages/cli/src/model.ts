/**
 * Picks the model a command runs from `--model <provider>:<model id>`. The key comes from the provider's own
 * environment variable, read here and passed to the adapter, because the gateway never reads one itself.
 */
import { createModel, type Model } from "@buildanagent/gateway";
import { anthropic } from "@buildanagent/gateway/anthropic";
import { openaiChat } from "@buildanagent/gateway/openai-chat";
import { CliError } from "./errors.js";

type Env = Readonly<Record<string, string | undefined>>;

const PROVIDERS = {
  anthropic: { variable: "ANTHROPIC_API_KEY", adapter: (apiKey: string) => anthropic({ apiKey }) },
  openai: { variable: "OPENAI_API_KEY", adapter: (apiKey: string) => openaiChat({ apiKey }) },
} as const;

const EXAMPLE = "anthropic:claude-sonnet-5-5";

/**
 * The model `spec` names, such as `anthropic:claude-sonnet-5-5`. Throws a `CliError`: `no_model` without a spec,
 * `usage` for an unknown provider, and `missing_api_key` when the provider's variable is unset.
 */
export function modelFromSpec(spec: string | undefined, env: Env): Model {
  if (spec === undefined) {
    throw new CliError(
      "no_model",
      `this command calls a model: pass --model <provider>:<model id>, such as ${EXAMPLE}`,
    );
  }
  const split = spec.indexOf(":");
  const provider = split < 0 ? spec : spec.slice(0, split);
  const id = split < 0 ? "" : spec.slice(split + 1);
  if (!Object.hasOwn(PROVIDERS, provider) || id === "") {
    throw new CliError("usage", `--model takes anthropic:<model id> or openai:<model id>, got ${JSON.stringify(spec)}`);
  }
  const { variable, adapter } = PROVIDERS[provider as keyof typeof PROVIDERS];
  const key = env[variable];
  if (key === undefined || key.trim() === "") {
    throw new CliError("missing_api_key", `--model ${provider}:… reads its key from ${variable}, which is not set`);
  }
  return createModel({ adapter: adapter(key), id });
}
