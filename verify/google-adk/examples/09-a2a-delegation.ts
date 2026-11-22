// Delegation to a remote agent over A2A, with both ends in one process on loopback. A "billing" agent is
// served by toA2a behind a bearer token, and a parent agent hands the conversation to it through a
// RemoteA2AAgent. The parent treats the remote agent as it treats an in-process subagent: it transfers to it
// by name, and the run yields the remote agent's events.
//
// As of November 2026, @google/adk 2.5.0 speaks A2A protocol 0.3, not 1.0: its cards say protocolVersion
// "0.3.0" and it is built on @a2a-js/sdk 0.3.14. It serves JSON-RPC and HTTP+JSON, with no gRPC.
//
// Three details differ from what the typings and the docs suggest:
//   - The typings document the basePath default as "a2a", but the code mounts at the root, so the example
//     sets basePath itself.
//   - RemoteA2AAgent's agentCard string is the card's base URL. ADK appends /.well-known/agent-card.json, so
//     a full card URL fails with a 404 on a doubled path.
//   - ADK's default client sends no credentials, so a server behind a token needs a client factory whose
//     fetch adds the header.
//
// The two behaviours that rested on compiled code both held when run: the remote reply arrives as an ordinary
// event of the parent's run, and a long-running tool ends the remote turn in the A2A state input-required.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AgentCard } from "@a2a-js/sdk";
import { ClientFactory, ClientFactoryOptions, JsonRpcTransportFactory } from "@a2a-js/sdk/client";
import {
  bearerTokenUserBuilder,
  FunctionTool,
  InMemoryRunner,
  LlmAgent,
  LongRunningFunctionTool,
  RemoteA2AAgent,
  toA2a,
} from "@google/adk";
import { z } from "zod";
import { afterTool, calls, callTool, check, ScriptedLlm, say, texts, turn } from "./lib/check.ts";

const HOST = "127.0.0.1"; // loopback only: nothing here listens on another address
const TOKEN = "billing-shared-secret";
const lookups: string[] = [];
const refunds: string[] = [];

// #region billing-agent
const lookupInvoice = new FunctionTool({
  name: "lookup_invoice",
  description: "Look up an invoice by id.",
  parameters: z.object({ invoiceId: z.string() }),
  execute: ({ invoiceId }) => {
    lookups.push(invoiceId);
    return { invoiceId, amount: 120, status: "overdue" };
  },
});
const requestRefund = new LongRunningFunctionTool({
  name: "request_refund",
  description: "Ask a human to approve a refund. The answer arrives later.",
  parameters: z.object({ invoiceId: z.string() }),
  execute: ({ invoiceId }) => {
    refunds.push(invoiceId);
    return { status: "pending approval" };
  },
});
const billingModel = new ScriptedLlm((req) => {
  const asked = JSON.stringify(req.contents);
  if (afterTool(req)) return say(asked.includes("pending") ? "Refund requested." : "Invoice inv-7 is overdue.");
  return asked.includes("refund")
    ? callTool("request_refund", { invoiceId: "inv-7" })
    : callTool("lookup_invoice", { invoiceId: "inv-7" });
});
const billing = new LlmAgent({
  name: "billing",
  description: "Answers questions about invoices.",
  model: billingModel,
  instruction: "Answer billing questions.",
  tools: [lookupInvoice, requestRefund],
});
// #endregion

/** A loopback port that was free a moment ago: the card must name its own address before the server listens. */
const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer().listen(0, HOST, () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });

const port = await freePort();
const origin = `http://${HOST}:${port}`;
// #region serve
const app = await toA2a(billing, {
  host: HOST,
  port,
  basePath: "", // set it: the typings say "a2a" but the code mounts at the root // book:note base-path
  authentication: bearerTokenUserBuilder(TOKEN), // book:note auth
});
const server: Server = await new Promise((resolve) => {
  const listening = app.listen(port, HOST, () => resolve(listening));
});
// #endregion

try {
  // Check 1: the card.
  const card = (await (await fetch(`${origin}/.well-known/agent-card.json`)).json()) as AgentCard;
  check(card.protocolVersion === "0.3.0", "the card says protocol 0.3.0, not 1.0");
  check(
    card.additionalInterfaces?.map((i) => i.transport).join() === "JSONRPC,HTTP+JSON" &&
      card.additionalInterfaces.every((i) => i.url.startsWith(`${origin}/`)),
    "the card offers JSON-RPC and HTTP+JSON on the loopback origin",
  );

  // The client side: the card is public, but ADK's default client sends no token, so give it one.
  const authed: typeof fetch = (input, init) =>
    fetch(input, { ...init, headers: { ...init?.headers, authorization: `Bearer ${TOKEN}` } });
  const clientFactory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      transports: [new JsonRpcTransportFactory({ fetchImpl: authed })],
    }),
  );
  const states: string[] = [];
  // #region delegate
  const remoteBilling = new RemoteA2AAgent({
    name: "billing",
    description: "Answers questions about invoices.",
    agentCard: origin, // the card's base URL: ADK appends /.well-known/agent-card.json itself // book:note card
    clientFactory,
    afterRequestCallbacks: [(_ctx, event) => void states.push(`${event.kind}:${(event as any).status?.state ?? ""}`)],
  });
  const parentModel = new ScriptedLlm(() => callTool("transfer_to_agent", { agent_name: "billing" }));
  const parent = new LlmAgent({
    name: "support",
    model: parentModel,
    instruction: "Hand billing questions to billing.",
    subAgents: [remoteBilling], // book:note same-as-local
  });
  const runner = new InMemoryRunner({ agent: parent, appName: "support" });
  const session = () => runner.sessionService.createSession({ appName: "support", userId: "u1" });
  // #endregion

  // Check 2: the remote reply is an event of the parent's run.
  const events = await turn(runner, (await session()).id, "Is invoice inv-7 paid?");
  check(
    calls(events).some((c) => c.name === "transfer_to_agent" && c.args?.agent_name === "billing"),
    "the parent transfers to the remote agent by name, as it would to a local subagent",
  );
  check(
    events.some((e) => e.author === "billing" && texts([e]).includes("Invoice inv-7 is overdue.")),
    "the remote agent's reply is an event of the parent's run, authored by it",
  );
  check(
    lookups.join() === "inv-7" && billingModel.requests.length === 2,
    "the remote agent ran its own tool and model on the other end of the socket",
  );

  check(states.at(-1) === "status-update:completed", "an ordinary remote turn ends in the A2A state completed");
  check(parentModel.requests.length === 1, "the parent's model was asked once, to choose the transfer");

  // Check 5: a long-running remote tool ends the remote turn as input-required.
  states.length = 0;
  const paused = await turn(runner, (await session()).id, "Please refund inv-7.");
  check(refunds.join() === "inv-7", "the remote agent called its long-running tool");
  const pending = paused.find((e) => e.author === "billing" && e.longRunningToolIds?.length);
  check(
    pending !== undefined && calls([pending])[0]?.name === "request_refund",
    "the parent's run carries the pending call, marked long-running, for the caller to answer",
  );
  check(
    states.at(-1) === "status-update:input-required",
    `the A2A task ends in input-required (saw ${states.join(", ")})`,
  );

  // Check 3: a request without the token never reaches the agent.
  const before = billingModel.requests.length;
  const send = (headers: Record<string, string>) =>
    fetch(`${origin}/jsonrpc`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: { message: { kind: "message", messageId: "m1", role: "user", parts: [{ kind: "text", text: "hi" }] } },
      }),
    });
  const logged: string[] = [];
  const realError = console.error;
  console.error = (...args) => void logged.push(args.join(" ")); // the SDK logs each rejection with a stack trace
  const [missing, wrong] = await Promise.all([send({}), send({ authorization: "Bearer wrong" })]).finally(() => {
    console.error = realError;
  });
  check(missing.status === 500, `a request without the token fails as HTTP 500, not 401 (got ${missing.status})`);
  check(wrong.status === 500, "a wrong token fails the same way");
  check(logged.length === 2, "the server logged both rejections");
  check(billingModel.requests.length === before, "neither refused request reached the agent's model");
  await send({ authorization: `Bearer ${TOKEN}` });
  check(billingModel.requests.length > before, "the same request with the token does reach it");

  // Check 4: no authentication, no server.
  const refusal = await toA2a(billing, { host: HOST, port, basePath: "" }).then(
    () => "mounted",
    (e: Error) => e.message,
  );
  check(
    refusal.includes("refusing to mount the A2A server without authentication"),
    "toA2a refuses to mount without authentication unless allowUnauthenticated is true",
  );
} finally {
  await new Promise((resolve) => server.close(resolve)); // book:note close
}
