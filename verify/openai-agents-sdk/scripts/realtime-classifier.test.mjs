// Run with `node --test scripts/realtime-classifier.test.mjs`: sources that must run and sources that must be skipped.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { realtimeNeedsConnection } from "./realtime-classifier.mjs";

const IMPORTS = `import { RealtimeAgent, RealtimeSession } from "@openai/agents-realtime";
import { ScriptedRealtimeTransport } from "@openai/agents-realtime/testing";
const agent = new RealtimeAgent({ name: "a" });
`;
const SCRIPTED = `${IMPORTS}const transport = new ScriptedRealtimeTransport();\n`;

const RUN = {
  "our example": readFileSync(new URL("../examples/14-realtime-session.ts", import.meta.url), "utf8"),
  "shorthand transport": `${SCRIPTED}const s = new RealtimeSession(agent, { transport });`,
  "named transport": `${SCRIPTED}const s = new RealtimeSession(agent, { transport: transport, model: "m" });`,
  "no realtime at all": `import { Agent } from "@openai/agents";`,
};
const SKIP = {
  "doc block with no testing import": `import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";
const s = new RealtimeSession(new RealtimeAgent({ name: "a" }));`,
  "testing import only in a comment": `// import { ScriptedRealtimeTransport } from "@openai/agents-realtime/testing";
import { RealtimeAgent, RealtimeSession } from "@openai/agents-realtime";
const s = new RealtimeSession(new RealtimeAgent({ name: "a" }), { transport: "websocket" });`,
  "testing import only in a block comment": `/* from "@openai/agents-realtime/testing" */
import { RealtimeSession } from "@openai/agents-realtime";
const transport = new ScriptedRealtimeTransport();
const s = new RealtimeSession(agent, { transport });`,
  "a second session with no transport": `${SCRIPTED}const a = new RealtimeSession(agent, { transport });
const b = new RealtimeSession(agent);`,
  "a second session with other options only": `${SCRIPTED}const a = new RealtimeSession(agent, { transport });
const b = new RealtimeSession(agent, { model: "m" });`,
  "a websocket string": `${SCRIPTED}const s = new RealtimeSession(agent, { transport: "websocket" });`,
  "a webrtc string": `${SCRIPTED}const s = new RealtimeSession(agent, { transport: 'webrtc' });`,
  "a real transport class": `${SCRIPTED}import { OpenAIRealtimeWebSocket } from "@openai/agents-realtime";
const s = new RealtimeSession(agent, { transport: new OpenAIRealtimeWebSocket() });`,
  "an aliased real transport": `${SCRIPTED}const T = OpenAIRealtimeWebSocket;
const s = new RealtimeSession(agent, { transport: new T() });`,
  "a transport that is not scripted": `${IMPORTS}const transport = makeTransport();
const s = new RealtimeSession(agent, { transport });`,
  "an inline transport expression": `${IMPORTS}const s = new RealtimeSession(agent, { transport: pick() });`,
  "an inline transport expression next to a scripted transport of the shorthand name": `${IMPORTS}const transport = new ScriptedRealtimeTransport(); const s = new RealtimeSession(agent, { transport: pick() });`,
  "a renamed session class": `import { RealtimeSession as RS } from "@openai/agents-realtime";
${SCRIPTED}const s = new RS(agent);`,
  "a dynamic import": `${SCRIPTED}const m = await import("@openai/agents-realtime");
const s = new RealtimeSession(agent, { transport });`,
};

for (const [name, code] of Object.entries(RUN)) {
  test(`runs: ${name}`, () => assert.equal(realtimeNeedsConnection(code), false));
}
for (const [name, code] of Object.entries(SKIP)) {
  test(`skips: ${name}`, () => assert.equal(realtimeNeedsConnection(code), true));
}
