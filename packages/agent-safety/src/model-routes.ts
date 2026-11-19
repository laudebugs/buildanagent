/**
 * `checkModelRoutes()`: the deploy check that every model route keeps the user's own key. A route through Cloudflare
 * AI Gateway passes only with `byok_only: true`, and a route through Vercel AI Gateway never passes.
 */
import { isCloudflareAiGatewayHost, parseModelBaseUrl } from "./model-url.js";

/**
 * The date of the gateway documentation the checker's setting names come from: Cloudflare AI Gateway's Unified
 * Billing page (`byok_only`, "Require provider credentials") and Vercel AI Gateway's BYOK page ("Fallback to Vercel
 * Keys"). A field the checker doesn't know fails the check, so a renamed setting is caught rather than passed.
 */
export const MODEL_ROUTE_SETTINGS_AS_OF = "2026-11-18";

/** The providers a model route may name. */
export type ModelRouteProvider = "anthropic" | "openai";

/** The Cloudflare AI Gateway settings a route through that gateway must record. */
export interface CloudflareAiGatewaySettings {
  /** Cloudflare's "Require provider credentials": the gateway refuses to bill its own credentials. Must be `true`. */
  readonly byok_only: boolean;
}

/** One model route a deploy configures: which provider, at which base URL, and the gateway's settings if it has one. */
export interface ModelRoute {
  readonly provider: ModelRouteProvider;
  readonly baseURL: string;
  /** Required when `baseURL` is on Cloudflare AI Gateway, and not allowed otherwise. */
  readonly cloudflareAiGateway?: CloudflareAiGatewaySettings;
}

/** The model routes a deploy step produces, which `checkModelRoutes()` reads. */
export interface ModelRoutesConfig {
  readonly routes: readonly ModelRoute[];
}

/**
 * Why a configuration failed. `invalid_config`: it doesn't have the shape `ModelRoutesConfig` describes.
 * `unknown_field`: it names a field the checker doesn't know. `invalid_base_url`: a base URL breaks the rules
 * `egressGuard()` applies. `vercel_ai_gateway`: a route goes through Vercel AI Gateway. `byok_only_missing` and
 * `byok_only_off`: a route through Cloudflare AI Gateway doesn't record `byok_only: true`.
 */
export type ModelRouteProblemCode =
  | "invalid_config"
  | "unknown_field"
  | "invalid_base_url"
  | "vercel_ai_gateway"
  | "byok_only_missing"
  | "byok_only_off";

/** One reason a configuration failed. */
export interface ModelRouteProblem {
  readonly code: ModelRouteProblemCode;
  /** The index of the route at fault, or absent for a problem with the configuration as a whole. */
  readonly route?: number;
  readonly message: string;
}

/** What `checkModelRoutes()` found. `ok` is true only when `problems` is empty. */
export interface ModelRoutesReport {
  readonly ok: boolean;
  readonly problems: readonly ModelRouteProblem[];
  /** The documentation date the checker was written against, `MODEL_ROUTE_SETTINGS_AS_OF`. */
  readonly settingsAsOf: string;
}

const CONFIG_FIELDS = new Set(["routes"]);
const ROUTE_FIELDS = new Set(["provider", "baseURL", "cloudflareAiGateway"]);
const CLOUDFLARE_FIELDS = new Set(["byok_only"]);
const PROVIDERS = new Set<string>(["anthropic", "openai"]);
// Provider names that mean "let the AI SDK's gateway pick the credential".
const GATEWAY_PROVIDERS = new Set(["gateway", "vercel"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownFields(value: Record<string, unknown>, known: Set<string>, where: string, route?: number) {
  return Object.keys(value)
    .filter((key) => !known.has(key))
    .map(
      (key): ModelRouteProblem =>
        withRoute({ code: "unknown_field", message: `${where} has unknown field ${key}` }, route),
    );
}

function withRoute(problem: Omit<ModelRouteProblem, "route">, route: number | undefined): ModelRouteProblem {
  return route === undefined ? problem : { ...problem, route };
}

function checkProvider(provider: unknown, route: number): ModelRouteProblem[] {
  if (typeof provider === "string" && PROVIDERS.has(provider)) return [];
  if (typeof provider === "string" && GATEWAY_PROVIDERS.has(provider)) {
    return [{ code: "vercel_ai_gateway", route, message: `provider ${provider} routes through Vercel AI Gateway` }];
  }
  return [{ code: "invalid_config", route, message: "provider must be anthropic or openai" }];
}

function checkCloudflareSettings(settings: unknown, route: number): ModelRouteProblem[] {
  const missing: ModelRouteProblem = {
    code: "byok_only_missing",
    route,
    message: "a route through Cloudflare AI Gateway must record cloudflareAiGateway.byok_only: true",
  };
  if (settings === undefined) return [missing];
  if (!isRecord(settings)) return [{ code: "invalid_config", route, message: "cloudflareAiGateway must be an object" }];
  const problems = unknownFields(settings, CLOUDFLARE_FIELDS, "cloudflareAiGateway", route);
  const byokOnly = settings.byok_only;
  if (byokOnly === undefined) problems.push(missing);
  else if (byokOnly === false) {
    problems.push({ code: "byok_only_off", route, message: "Cloudflare AI Gateway's byok_only is false" });
  } else if (byokOnly !== true) {
    problems.push({ code: "invalid_config", route, message: "cloudflareAiGateway.byok_only must be a boolean" });
  }
  return problems;
}

function checkRoute(value: unknown, route: number): ModelRouteProblem[] {
  if (!isRecord(value)) return [{ code: "invalid_config", route, message: "a route must be an object" }];
  const problems = [...unknownFields(value, ROUTE_FIELDS, "the route", route), ...checkProvider(value.provider, route)];
  const parsed = parseModelBaseUrl(value.baseURL);
  if (!parsed.ok) return [...problems, { code: parsed.problem, route, message: parsed.message }];
  if (isCloudflareAiGatewayHost(parsed.url.hostname)) {
    problems.push(...checkCloudflareSettings(value.cloudflareAiGateway, route));
  } else if (value.cloudflareAiGateway !== undefined) {
    problems.push({
      code: "invalid_config",
      route,
      message: "cloudflareAiGateway is set on a route whose base URL isn't on Cloudflare AI Gateway",
    });
  }
  return problems;
}

/**
 * Checks the model routes a deploy configures and reports every problem, so a deploy gate can fail on any of them.
 * The check fails closed: a configuration that isn't a `ModelRoutesConfig`, lists no routes or names an unknown field
 * fails, as does a route through Vercel AI Gateway, whose fallback to Vercel's own keys is a team dashboard setting
 * that no configuration records. A route through Cloudflare AI Gateway passes only with `byok_only: true`.
 */
export function checkModelRoutes(config: unknown): ModelRoutesReport {
  const report = (problems: ModelRouteProblem[]): ModelRoutesReport => ({
    ok: problems.length === 0,
    problems,
    settingsAsOf: MODEL_ROUTE_SETTINGS_AS_OF,
  });
  if (!isRecord(config)) return report([{ code: "invalid_config", message: "the configuration must be an object" }]);
  const problems = unknownFields(config, CONFIG_FIELDS, "the configuration");
  const routes = config.routes;
  if (!Array.isArray(routes) || routes.length === 0) {
    problems.push({ code: "invalid_config", message: "the configuration must list at least one route" });
    return report(problems);
  }
  routes.forEach((route: unknown, index) => {
    problems.push(...checkRoute(route, index));
  });
  return report(problems);
}
