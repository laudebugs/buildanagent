// A computer-use tool against a fake computer. The model's `computer_call` items go to the agent's `computerTool`, which
// runs each requested action on an in-memory `Computer` that records it and returns a fixture screenshot, so no screen,
// browser, file or network is involved. The tool's `needsApproval` sees every action, batched ones included: typing
// runs at once, while the click on the Pay button pauses the run until a person approves it. A paused run has not
// clicked the button, and a rejected click never reaches the computer. `ScriptedModel`'s helpers build only function
// calls and messages, so the computer calls are raw items inside `modelResponse()`.
// Docs: guides/tools.mdx "Computer tool specifics", guides/human-in-the-loop.mdx
import { Agent, type Computer, computerTool, RunState } from "@openai/agents";
import { assistantMessage, modelResponse, ScriptedModel } from "@openai/agents/testing";
import { check, runner } from "./lib/check.ts";

const PAY_BUTTON = { x: 410, y: 305, reach: 40 };
const INVOICE_FIELD = { x: 120, y: 80 };
const INVOICE_NUMBER = "ACME-1042";

/** A screen is a fixed string, base64 encoded the way a screenshot is returned: no host screen is ever read. */
const SCREENS = { empty: "screen:invoice-empty", filled: "screen:invoice-filled", receipt: "screen:receipt" };
const screenshotOf = (name: keyof typeof SCREENS) => Buffer.from(SCREENS[name]).toString("base64");

// #region fake-computer
type Recorded = [method: string, ...args: unknown[]];
const hitsPayButton = (x: number, y: number) =>
  Math.abs(x - PAY_BUTTON.x) <= PAY_BUTTON.reach && Math.abs(y - PAY_BUTTON.y) <= PAY_BUTTON.reach;

/** A computer that is only a list of what it was asked to do, plus a tiny page state that picks its screenshot. */
function fakeComputer() {
  const log: Recorded[] = [];
  const page = { typed: "", paid: false };
  const computer: Computer = {
    environment: "browser",
    dimensions: [800, 600],
    screenshot: () => {
      log.push(["screenshot"]);
      return screenshotOf(page.paid ? "receipt" : page.typed ? "filled" : "empty");
    },
    click: (x, y, button) => {
      log.push(["click", x, y, button]);
      if (hitsPayButton(x, y)) page.paid = true;
    },
    type: (text) => {
      log.push(["type", text]);
      page.typed += text;
    },
    keypress: (keys) => void log.push(["keypress", keys]),
    doubleClick: (x, y) => void log.push(["doubleClick", x, y]),
    scroll: (x, y, sx, sy) => void log.push(["scroll", x, y, sx, sy]),
    wait: () => void log.push(["wait"]),
    move: (x, y) => void log.push(["move", x, y]),
    drag: (path) => void log.push(["drag", path]),
  };
  return { computer, log, page };
}
// #endregion

// The raw output item a model emits for a computer action; `ScriptedModel`'s helpers have no builder for it.
const click = (x: number, y: number) => ({ type: "click" as const, x, y, button: "left" as const });
const computerCall = (callId: string, ...actions: Record<string, unknown>[]) =>
  ({ type: "computer_call", callId, status: "completed", actions }) as never;

function setup(finalAnswer = "Paid invoice ACME-1042.") {
  const fake = fakeComputer();
  const asked: string[] = []; // every action `needsApproval` was asked about
  // #region computer-tool
  const computer = computerTool({
    computer: fake.computer,
    needsApproval: async (_context, action) => {
      asked.push(action.type);
      return action.type === "click" && hitsPayButton(action.x, action.y); // book:note consequential
    },
  });
  // #endregion
  // #region script
  const model = new ScriptedModel([
    modelResponse([computerCall("c1", click(INVOICE_FIELD.x, INVOICE_FIELD.y))]),
    modelResponse([computerCall("c2", { type: "type", text: INVOICE_NUMBER }, { type: "keypress", keys: ["Tab"] })]), // book:note batch
    modelResponse([computerCall("c3", click(PAY_BUTTON.x, PAY_BUTTON.y))]), // book:note pay
    [assistantMessage(finalAnswer)],
  ]);
  // #endregion
  const agent = new Agent({ name: "Accounts payable", model, tools: [computer] });
  return { agent, model, ...fake, asked };
}

const resultFor = (request: { input: unknown }, callId: string) =>
  (Array.isArray(request.input) ? request.input : []).find(
    (item: { type?: string; callId?: string }) => item.type === "computer_call_result" && item.callId === callId,
  );

// a) The run pauses at the Pay click, and approval lets it through.
{
  const { agent, model, log, page, asked } = setup();
  // #region pause
  const first = await runner.run(agent, "Pay invoice ACME-1042"); // book:note pause
  // #endregion
  check(first.interruptions.length === 1, "the run pauses with one interruption");
  const paused = first.interruptions[0].rawItem as { type: string; callId: string; actions?: { type: string }[] };
  check(
    paused.type === "computer_call" && paused.callId === "c3" && paused.actions?.[0].type === "click",
    "the interruption is the model's Pay click, call c3",
  );
  const sequence = JSON.stringify(log.map(([method]) => method));
  check(
    sequence === JSON.stringify(["click", "screenshot", "type", "keypress", "screenshot"]),
    "before the pause the computer ran only the first two calls: one screenshot after each call, not after each action",
  );
  check(
    !page.paid && !log.some((entry) => entry[0] === "click" && hitsPayButton(Number(entry[1]), Number(entry[2]))),
    "the Pay click has not reached the computer while the run is paused",
  );
  const seen = (call: number, id: string) =>
    (resultFor(model.calls[call].request, id) as { output: { data: string } } | undefined)?.output.data;
  check(
    seen(1, "c1") === `data:image/png;base64,${screenshotOf("empty")}` &&
      seen(2, "c2") === `data:image/png;base64,${screenshotOf("filled")}`,
    "each call's result is the fixture screenshot of the page after its actions: empty after the click, filled after the typing",
  );
  check(
    JSON.stringify(asked) === JSON.stringify(["click", "type", "keypress", "click"]),
    "needsApproval was asked about every action, the batched ones included",
  );
  // #region resume
  const state = await RunState.fromString(agent, JSON.stringify(first.state)); // book:note save
  state.approve(first.interruptions[0]);
  const resumed = await runner.run(agent, state);
  // #endregion
  check(page.paid, "after approve() and resume, the Pay click reaches the computer");
  check(
    JSON.stringify(log.slice(5)) === JSON.stringify([["click", 410, 305, "left"], ["screenshot"]]),
    "the approved click runs once, followed by one screenshot",
  );
  const result = resultFor(model.calls[3].request, "c3") as { output: { data: string } } | undefined;
  check(
    result?.output.data === `data:image/png;base64,${screenshotOf("receipt")}`,
    "the model's last request carries the receipt screenshot as the result of call c3",
  );
  check(resumed.finalOutput === "Paid invoice ACME-1042.", "the resumed run finishes with the model's answer");
  model.assertComplete();
}

// b) A rejected click never reaches the computer.
{
  const unpaid = "The payment was not approved, so ACME-1042 is unpaid.";
  const { agent, log, page, model } = setup(unpaid);
  const first = await runner.run(agent, "Pay invoice ACME-1042");
  const state = await RunState.fromString(agent, JSON.stringify(first.state));
  state.reject(first.interruptions[0]);
  const resumed = await runner.run(agent, state);
  check(!page.paid && log.length === 5, "after reject(), the computer receives no further action");
  const rejected = resultFor(model.calls[3].request, "c3") as
    | { output: { data: string; providerData?: { approvalStatus?: string } } }
    | undefined;
  check(
    rejected?.output.providerData?.approvalStatus === "rejected" &&
      !rejected.output.data.includes(screenshotOf("filled")),
    "the model's next request holds a rejected result for c3 with a fallback image, not the page's screenshot",
  );
  check(resumed.finalOutput === unpaid, "the model still gets its next turn after the rejection and answers from it");
  model.assertComplete();
}

// c) The only tool offered is the computer tool: nothing that touches the host.
{
  const { agent } = setup();
  const model = new ScriptedModel([[assistantMessage("ok")]]);
  await runner.run(new Agent({ name: "Probe", model, tools: agent.tools }), "hi");
  const offered = model.calls.flatMap((call) => call.request.tools);
  check(
    offered.length === 1 && offered[0].type === "computer",
    "the model is offered one tool, the computer tool: no shell, file-editing or function tool",
  );
}
