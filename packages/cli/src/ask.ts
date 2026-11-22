/**
 * Asks the person at the terminal about the requests a turn paused on. Calls of one tool with the same input, after
 * a command's spaces are normalised, are shown as one group and take one answer, and a chained command is shown one
 * command per line, so an approver sees every command an approval would run.
 */
import type { SignedPendingRequest } from "@buildanagent/sdk";
import { chainedCommands, commandOf } from "./command-lines.js";
import type { CliIo } from "./io.js";
import type { PersonRequest, SessionWatch } from "./watch.js";

/** Several requests that one answer settles. */
interface Group {
  readonly requests: PersonRequest[];
  readonly input: unknown;
}

/** What tells two calls apart: the tool and the input, with a command's chain laid out as the approver reads it. */
function groupKey(request: SignedPendingRequest, input: unknown): string {
  const command = commandOf(input);
  const shown = command === undefined ? input : { ...(input as object), command: chainedCommands(command) };
  return `${request.tool}\u0000${JSON.stringify(shown) ?? request.inputHash}`;
}

/** The approvals grouped by tool and input, in the order they were asked; each clarification stands alone. */
export function groupRequests(requests: readonly PersonRequest[], inputs: ReadonlyMap<string, unknown>): Group[] {
  const groups = new Map<string, Group>();
  for (const request of requests) {
    const signed = request.params.request;
    const input = inputs.get(signed.id);
    const key =
      request.method === "clarification/request" || !inputs.has(signed.id)
        ? `request\u0000${signed.id}`
        : groupKey(signed, input);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { requests: [request], input });
    else group.requests.push(request);
  }
  return [...groups.values()];
}

/** The lines that describe a group's input: each chained command on its own line, or the input as JSON. */
export function inputLines(input: unknown): string[] {
  const command = commandOf(input);
  if (command === undefined) return [JSON.stringify(input) ?? "(no input)"];
  return chainedCommands(command).map((part) => `${part.operator} ${part.command}`.trim());
}

function describe(group: Group): string {
  const [first] = group.requests;
  const signed = (first as PersonRequest).params.request;
  const count = group.requests.length;
  const who =
    count === 1 ? `${signed.tool} needs your approval` : `${count} calls of ${signed.tool} need your approval`;
  const reason = signed.reason === undefined ? "" : `: ${signed.reason}`;
  const shown = group.input === undefined ? [`(input hash ${signed.inputHash})`] : inputLines(group.input);
  return `${who}${reason}\n${shown.map((line) => `    ${line}\n`).join("")}`;
}

/** Reads `y` or `n` until the person gives one, or `undefined` once input ends. */
async function readDecision(io: CliIo): Promise<"allow" | "deny" | undefined> {
  for (;;) {
    io.error("Allow? [y/n] ");
    const line = await io.readLine();
    if (line === undefined) return undefined;
    const word = line.trim().toLowerCase();
    if (word === "y" || word === "yes") return "allow";
    if (word === "n" || word === "no") return "deny";
  }
}

async function askClarification(io: CliIo, watch: SessionWatch, request: PersonRequest): Promise<boolean> {
  io.error(`The agent asks: ${request.params.request.question ?? "(no question)"}\n`);
  for (;;) {
    io.error("answer> ");
    const line = await io.readLine();
    if (line === undefined) return false;
    if (line.trim() === "") continue;
    watch.answer(request, { requestId: request.params.request.id, answer: line });
    return true;
  }
}

/**
 * Asks about every request waiting on `watch`, group by group, and sends each answer. Resolves `false` when input
 * ends first, leaving the unanswered requests waiting in the log for `resume`.
 */
export async function askPerson(io: CliIo, watch: SessionWatch): Promise<boolean> {
  for (const group of groupRequests([...watch.asked.values()], watch.inputs)) {
    const [first] = group.requests;
    if (first?.method === "clarification/request") {
      if (!(await askClarification(io, watch, first))) return false;
      continue;
    }
    io.error(describe(group));
    const decision = await readDecision(io);
    if (decision === undefined) return false;
    for (const request of group.requests) {
      watch.answer(request, { requestId: request.params.request.id, decision });
    }
  }
  return true;
}
