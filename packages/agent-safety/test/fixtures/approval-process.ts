// One side of the cross-process approval test, run by test/cross-process.test.ts in its own Node process.
//
// `pause <signer>` runs a refund agent until its call waits for approval, and prints the history and the stored
// pending requests. `resume <signer>` reads that JSON from stdin, approves the call and prints what ran. `<signer>` is
// `ring`, which loads the key ring from KEY_RING, or `ephemeral`. The two processes share nothing else.
//
// It imports the package's source by relative path, so it needs no `source` condition, and `ai` loads its built files.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { generateText, jsonSchema, type ModelMessage, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { signedToolApproval } from "../../src/ai/index.js";
import {
  type ApprovalSigner,
  ephemeralSigner,
  memoryPendingStore,
  parseKeyRing,
  type SignedPendingRequest,
  signerFromKeyStore,
} from "../../src/index.js";

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

interface Handoff {
  readonly history: ModelMessage[];
  readonly pending: SignedPendingRequest[];
}

function model() {
  return new MockLanguageModelV4({
    doGenerate: async (options: LanguageModelV4CallOptions) => {
      const resumed = options.prompt.some((message) => message.role === "tool");
      return {
        content: resumed
          ? [{ type: "text", text: "Done." }]
          : [{ type: "tool-call", toolCallId: "call_1", toolName: "refund", input: '{"order":4417}' }],
        finishReason: { unified: resumed ? "stop" : "tool-calls", raw: undefined },
        usage: USAGE,
        warnings: [],
      };
    },
  });
}

async function signer(kind: string | undefined): Promise<ApprovalSigner> {
  if (kind === "ephemeral") return ephemeralSigner();
  assert.equal(kind, "ring");
  const text = process.env.KEY_RING;
  assert.ok(text, "KEY_RING is set");
  return signerFromKeyStore({ load: async () => parseKeyRing(text) });
}

async function main(mode: string | undefined, signerKind: string | undefined) {
  const executed: unknown[] = [];
  const denials: string[] = [];
  const store = memoryPendingStore();
  const refund = tool({
    inputSchema: jsonSchema<{ order: number }>({ type: "object" }),
    execute: async (input) => executed.push(input),
  });
  const toolApproval = signedToolApproval({
    signer: await signer(signerKind),
    store,
    policy: { refund: "user-approval" },
    recheck: async () => "allow",
    onRejected: (rejection) => denials.push(rejection.cause),
  });
  const run = (messages: ModelMessage[]) => generateText({ model: model(), messages, tools: { refund }, toolApproval });
  if (mode === "pause") {
    const prompt: ModelMessage[] = [{ role: "user", content: "Refund order 4417." }];
    const result = await run(prompt);
    const pending = await store.take("call_1");
    assert.ok(pending, "the pause stored a signed request");
    const handoff: Handoff = { history: [...prompt, ...result.response.messages], pending: [pending] };
    process.stdout.write(JSON.stringify(handoff));
    return;
  }
  assert.equal(mode, "resume");
  const handoff = JSON.parse(readFileSync(0, "utf8")) as Handoff;
  for (const request of handoff.pending) await store.put(request);
  const approvalIds = handoff.history.flatMap((message) =>
    message.role === "assistant" && typeof message.content !== "string"
      ? message.content.flatMap((part) => (part.type === "tool-approval-request" ? [part.approvalId] : []))
      : [],
  );
  const content = approvalIds.map((approvalId) => ({
    type: "tool-approval-response" as const,
    approvalId,
    approved: true,
  }));
  await run([...handoff.history, { role: "tool", content }]);
  process.stdout.write(JSON.stringify({ executed: executed.length, denials }));
}

await main(process.argv[2], process.argv[3]);
