// A realtime session on the SDK's scripted transport. A `RealtimeSession` normally talks to OpenAI over WebRTC or a
// WebSocket; here it talks to `ScriptedRealtimeTransport`, an in-memory transport that records every call the session
// makes and lets the example emit the events a server would send. No model, audio or network is involved, so the
// example scripts what the model "said" and checks what the session did with it. Four behaviours are checked: the
// session's history follows the items the transport reports; a scripted `function_call` runs the agent's tool and the
// result goes back through `sendFunctionCallOutput`; a tool with `needsApproval` raises `tool_approval_requested` and
// runs only after `session.approve()`; and `session.interrupt()` reaches the transport, while a scripted
// `audio_interrupted` reaches the session's own listener. On this transport neither causes the other: the session adds
// no `audio_interrupted` of its own, and the scripted transport adds none when it records an interrupt.
// Limits, as of `@openai/agents-realtime` 0.21.0 (November 2026). The testing guide's examples cover the history, tool
// and interruption checks, but none of them approves a tool call, so the approval check is our own. The scripted
// transport's `interrupt()` only records the call. The real WebSocket transport also emits `audio_interrupted` itself
// and sends a `conversation.item.truncate` event that cuts the reply to the audio the caller heard, so this example
// cannot show truncation, and it says nothing about what a real model chooses to say.
// Docs: guides/testing.mdx "Test a Voice agent tool workflow" and "Test interruption";
// guides/voice-agents/build.mdx "Approval before tool execution"
import type { RunToolApprovalItem } from "@openai/agents-core";
import { RealtimeAgent, type RealtimeItem, RealtimeSession, tool } from "@openai/agents-realtime";
import { ScriptedRealtimeTransport } from "@openai/agents-realtime/testing";
import { z } from "zod";
import { check } from "./lib/check.ts";

const ORDER_ID = "order_123";
const WAIT_MS = 5_000;

/** Bounds a wait on the session, so a missing call fails the example with a message instead of hanging it. */
async function within<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`ASSERTION FAILED: nothing arrived within ${WAIT_MS} ms`)), WAIT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// The tools read and write an in-memory list: nothing on the host, and no shell or file tool is offered.
const looked: string[] = [];
const cancelled: string[] = [];
// A count is read through a function, so a check sees the list as it is then, not as an earlier check narrowed it.
const count = (list: readonly unknown[]) => () => list.length;
const cancelledCount = count(cancelled);

// #region tools
const lookupOrder = tool({
  name: "lookup_order",
  description: "Looks up an order by ID.",
  parameters: z.object({ orderId: z.string() }),
  execute: async ({ orderId }) => {
    looked.push(orderId);
    return `Order ${orderId} has shipped.`;
  },
});
const cancelOrder = tool({
  name: "cancel_order",
  description: "Cancels an order by ID.",
  parameters: z.object({ orderId: z.string() }),
  needsApproval: true, // book:note approval
  execute: async ({ orderId }) => {
    cancelled.push(orderId);
    return `Order ${orderId} is cancelled.`;
  },
});
// #endregion

// #region session
const agent = new RealtimeAgent({
  name: "Order assistant",
  instructions: "Help customers track and cancel their orders.",
  tools: [lookupOrder, cancelOrder],
});
const transport = new ScriptedRealtimeTransport(); // book:note scripted-transport
const session = new RealtimeSession(agent, { transport });
// #endregion

/** The next approval request the session raises: its kind, the tool's name and the item to approve or reject. */
const nextApproval = () =>
  new Promise<{ kind: string; toolName: string; item: RunToolApprovalItem }>((resolve) =>
    session.once("tool_approval_requested", (_context, _agent, request) =>
      resolve({
        kind: request.type,
        toolName: request.type === "function_approval" ? request.tool.name : "",
        item: request.approvalItem,
      }),
    ),
  );

let responses = 0;
/** Scripts the server starting a response, and returns its id. */
function startResponse(): string {
  const id = `response_${++responses}`;
  transport.emit("turn_started", { type: "response_started", providerData: { response: { id } } });
  return id;
}
/** Scripts the model choosing a tool: the session, not the transport, runs it. */
function scriptToolCall(name: string, callId: string, args: object): void {
  const responseId = startResponse();
  transport.emit("function_call", { type: "function_call", name, callId, arguments: JSON.stringify(args), responseId });
}

const connected = transport.expectCall("connect");
await session.connect({ apiKey: "test" });
await connected;

// a) History: the session's history is what the transport reports, item by item.
{
  const sent = transport.expectCall("sendMessage");
  session.sendMessage("Where is order 123?");
  check((await sent).message === "Where is order 123?", "sendMessage reaches the transport with the caller's text");
  const script: RealtimeItem[] = [
    {
      itemId: "user_1",
      type: "message",
      role: "user",
      status: "completed",
      content: [{ type: "input_text", text: "Where is order 123?" }],
    },
    {
      itemId: "assistant_1",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "Let me check." }],
    },
  ];
  // #region history
  for (const item of script) transport.emit("item_update", item); // book:note history
  // #endregion
  check(
    JSON.stringify(session.history) === JSON.stringify(script),
    "after two scripted item updates, session.history equals the script",
  );
}

// b) A tool call: the scripted function_call runs the tool, and its output goes back through the transport.
{
  // #region tool-call
  const output = transport.expectCall("sendFunctionCallOutput");
  scriptToolCall("lookup_order", "call_1", { orderId: ORDER_ID });
  const returned = await within(output);
  // #endregion
  check(JSON.stringify(looked) === JSON.stringify([ORDER_ID]), "the lookup_order tool ran once, with the scripted id");
  check(
    returned.toolCall.callId === "call_1" && returned.output === `Order ${ORDER_ID} has shipped.`,
    "the tool's output returns through sendFunctionCallOutput for call_1",
  );
  check(returned.startResponse, "the session asks the model to continue after the tool's output");
}

// c) An approval: the tool waits for approve(), and a rejected call never runs.
{
  const requested = nextApproval();
  scriptToolCall("cancel_order", "call_2", { orderId: ORDER_ID });
  const request = await within(requested);
  check(
    request.kind === "function_approval" && request.toolName === "cancel_order",
    "cancel_order raises tool_approval_requested instead of running",
  );
  check(
    cancelledCount() === 0 && transport.calls.filter((c) => c.method === "sendFunctionCallOutput").length === 1,
    "before approval the tool has not run and no second output has gone to the transport",
  );
  // #region approve
  const output = transport.expectCall("sendFunctionCallOutput");
  await session.approve(request.item); // book:note approve
  const returned = await within(output);
  // #endregion
  check(
    JSON.stringify(cancelled) === JSON.stringify([ORDER_ID]) &&
      returned.toolCall.callId === "call_2" &&
      returned.output === `Order ${ORDER_ID} is cancelled.`,
    "after approve(), the tool runs once and its output returns through the transport for call_2",
  );

  const rejection = "A person declined the cancellation.";
  const rejectedRequest = nextApproval();
  scriptToolCall("cancel_order", "call_3", { orderId: ORDER_ID });
  const rejectedOutput = transport.expectCall("sendFunctionCallOutput");
  await session.reject((await within(rejectedRequest)).item, { message: rejection });
  const refused = await within(rejectedOutput);
  check(
    refused.toolCall.callId === "call_3" && refused.output === rejection && cancelledCount() === 1,
    "after reject(), the model receives the rejection text and the tool does not run again",
  );
}

// d) An interruption: interrupt() goes to the transport; audio_interrupted comes back from it. Each is its own event.
{
  const events: string[] = [];
  const interruptedCount = () => events.filter((e) => e === "audio_interrupted").length;
  session.on("audio_start", () => void events.push("audio_start"));
  session.on("audio_interrupted", () => void events.push("audio_interrupted"));
  const responseId = startResponse();
  transport.emit("audio", { type: "audio", responseId, data: new Uint8Array([1, 2, 3]).buffer });
  check(
    events.length === 1 && events[0] === "audio_start",
    "the session sees the first audio chunk of the reply as audio_start",
  );
  // #region interrupt
  const interruptCall = transport.expectCall("interrupt");
  session.interrupt(); // book:note interrupt
  await within(interruptCall);
  // #endregion
  check(interruptedCount() === 0, "interrupt() sends the request but does not itself raise audio_interrupted");
  // #region interrupted
  transport.emit("audio_interrupted"); // book:note interrupted
  // #endregion
  check(interruptedCount() === 1, "a scripted audio_interrupted reaches the session's listener once");
}

// e) The session only had the two in-memory tools, and the script was used up.
{
  const closed = transport.expectCall("close");
  session.close();
  await closed;
  const offered = agent.tools.map((t) => (t.type === "function" ? t.name : t.type));
  check(
    JSON.stringify(offered) === JSON.stringify(["lookup_order", "cancel_order"]) && agent.handoffs.length === 0,
    "the agent offers only lookup_order and cancel_order: no shell, file-editing or handoff",
  );
  // The transport's own assertions throw on an unmatched call or a transport that is still open.
  const passes = (assertion: () => void) => {
    try {
      assertion();
      return true;
    } catch {
      return false;
    }
  };
  check(
    passes(() => transport.assertComplete()),
    "every call the session made was matched by an expectation",
  );
  check(
    passes(() => transport.assertClosed()),
    "the transport is closed after session.close()",
  );
}
