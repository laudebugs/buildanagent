// The docs checks for agent-safety's README (../../scripts/package-docs.mjs): every TypeScript block in README.md type-checks,
// every block of more than five lines comes from a file in examples/, every export name it documents is in the
// declaration files, unstable names carry `experimental_`, and llms.txt is current.
//
//   node packages/agent-safety/scripts/docs-check.mjs           fails on any problem, a stale llms.txt included
//   node packages/agent-safety/scripts/docs-check.mjs --write   rewrites llms.txt first
//
// test/docs-check.test.ts runs the same checks under `pnpm test`.
import { fileURLToPath } from "node:url";
import { main } from "../../../scripts/package-docs.mjs";

export const PACKAGE_DIR = fileURLToPath(new URL("../", import.meta.url));

export const CONFIG = {
  globals: "scripts/readme-globals.ts",
  alsoNames: ["../gateway"],
  blocksFromExamples: true,
  // Prose names that look like exports but are not this package's: members, fields, variables and other packages' names.
  notExports: {
    AIChatAgent: "Cloudflare's @cloudflare/ai-chat class",
    AI_GATEWAY_API_KEY: "an environment variable",
    ANTHROPIC_API_KEY: "an environment variable",
    ANTHROPIC_BASE_URL: "an environment variable",
    CARD_DECLINED: "an outcome reason",
    ClientRequestToken: "a DynamoDB request field",
    DynamoDBClient: "the AWS SDK's client class",
    EXPIRED: "an outcome reason",
    GETDEL: "a Redis command",
    IDEMPOTENCY_KEY_REUSED: "an outcome reason",
    IN_PROGRESS: "an outcome reason",
    InvalidToolApprovalSignatureError: "the AI SDK's error class",
    NOT_VERIFIED: "an outcome reason",
    OPENAI_API_KEY: "an environment variable",
    OPENAI_BASE_URL: "an environment variable",
    Pool: "pg's client class",
    RETURNING: "a SQL clause",
    RetryError: "the AI SDK's error class",
    STALE_APPROVAL: "an outcome reason",
    Think: "Cloudflare's @cloudflare/think class",
    WRITE_INTERRUPTED: "an outcome reason",
    add: "a Spend method",
    begin: "an EffectStore method",
    claim: "a PlanLedger method",
    createAnthropic: "a function of @ai-sdk/anthropic",
    execute: "an AI SDK tool's method",
    get: "an EffectStore and Spend method",
    getModel: "a Think method",
    load: "a KeyStore method",
    put: "a PendingStore method",
    settle: "an EffectStore method",
    take: "a PendingStore method",
    takeOver: "an EffectStore method",
  },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(PACKAGE_DIR, CONFIG));
