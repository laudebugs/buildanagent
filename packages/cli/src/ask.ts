/**
 * Asks the person at the terminal about the requests a turn paused on. Calls of one tool with the same input are shown
 * as one group and take one answer, and a chained command is shown one command per line, so an approver sees every
 * command an approval would run. Everything the model or the log supplied passes through `visible()` on its way to
 * the terminal, so a control character in it can't rewrite the prompt the approver reads.
 */
import type { SignedPendingRequest } from "@buildanagent/sdk";
import { chainedCommands, commandOf } from "./command-lines.js";
import type { CliIo } from "./io.js";
import { visible } from "./visible.js";
import type { PersonRequest, SessionWatch } from "./watch.js";

/** Several requests that one answer settles. */
interface Group {
  readonly requests: PersonRequest[];
  readonly input: unknown;
}

/**
 * What tells two calls apart: the tool and the input exactly as the call would run it. A key from the laid-out text
 * would let two commands that run differently but read alike share one answer, so only identical calls group.
 */
function groupKey(request: SignedPendingRequest, input: unknown): string {
  return `${request.tool}\u0000${JSON.stringify(input) ?? request.inputHash}`;
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

/**
 * The lines that describe a group's input: each chained command on its own line, or the input as JSON. The input's
 * other fields follow the command as compact JSON, because they change what it does: `rm -rf build` with `cwd` set to
 * `/` is not the command it reads as alone. A command whose quotes never close gets a warning line, since its split
 * may hide a command inside the last line.
 */
export function inputLines(input: unknown): string[] {
  const command = commandOf(input);
  if (command === undefined) return [visible(JSON.stringify(input) ?? "(no input)")];
  const parts = chainedCommands(command);
  const lines = parts.map((part) => visible(`${part.operator} ${part.command}`.trim()));
  if (parts.at(-1)?.unclosed === true) {
    lines.push("(a quote or parenthesis never closes, so the last line may hold more than one command)");
  }
  const { command: _command, ...rest } = input as Record<string, unknown>;
  if (Object.keys(rest).length > 0) lines.push(`with ${visible(JSON.stringify(rest))}`);
  return lines;
}

function describe(group: Group): string {
  const [first] = group.requests;
  const signed = (first as PersonRequest).params.request;
  const count = group.requests.length;
  const who =
    count === 1
      ? `${visible(signed.tool)} needs your approval`
      : `${count} calls of ${visible(signed.tool)} need your approval`;
  const reason = signed.reason === undefined ? "" : `: ${visible(signed.reason)}`;
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
  const { question } = request.params.request;
  io.error(`The agent asks: ${question === undefined ? "(no question)" : visible(question)}\n`);
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
