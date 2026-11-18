// Shared helpers for the verified examples. They run under scripts/run-examples.mjs, whose preload
// starts the mock model and sets COPILOT_MOCK_URL.
import { readFileSync } from "node:fs";
import type { ProviderConfig } from "@github/copilot-sdk";

/** BYOK provider config that sends every model call to the offline mock (Anthropic Messages API). */
export function mockProvider(): ProviderConfig {
  const baseUrl = process.env.COPILOT_MOCK_URL;
  if (!baseUrl) throw new Error("COPILOT_MOCK_URL is unset: run through scripts/run-examples.mjs");
  return { type: "anthropic", baseUrl, apiKey: "mock-not-a-real-key" };
}

/** The model id our examples ask for; the mock ignores it. */
export const MODEL = "claude-sonnet-4.5";

export interface MockRequest {
  path: string;
  tools?: string[];
  plan?: { tool?: string; input?: unknown; text?: string };
  body: any;
}

/** Every model request the mock received so far in this run. */
export function mockRequests(): MockRequest[] {
  return readFileSync(process.env.MOCK_LOG ?? "", "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => r.path?.endsWith("/v1/messages"));
}

export function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
}
