// A stand-in for a decision model, for 15-decision-gate.ts. It takes the request shape the vendors share, a state and
// typed questions, and answers from a table. TypeSafe's Jev, Cloudflare's Clef and OpenAI's Decisions API all work
// this way as of November 2026, and the table imitates that shape only. It reads no text and measures no model, so
// every probability in it is a number the example chose. The real APIs answer each question without seeing the
// others and ignore a question that depends on another's answer, so the table throws on one to make the mistake
// visible.

/** One question the decision model answers: a yes or no, a pick from a fixed set, or a score. */
export type Question =
  | { id: string; kind: "predicate"; ask: string }
  | { id: string; kind: "score"; ask: string }
  | { id: string; kind: "choice"; ask: string; options: readonly string[] };

/** The model's answer to one question: a probability for each allowed option, and no generated text. */
export type Answer =
  | { kind: "predicate"; yes: number }
  | { kind: "choice"; probs: Record<string, number> }
  | { kind: "score"; score: number };

/** What the gate needs of a decision model: send a state and independent questions, receive typed answers. */
export interface DecideClient {
  /** Answers every question about `state`. A question that names another question's answer in the same request makes the stand-in throw. */
  decide(state: string, questions: Question[]): Promise<Record<string, Answer>>;
}

/** What the table holds for one state: a probability per question id, or for a choice its option, or `[option, p]`. */
export type Row = Record<string, number | string | [string, number]>;

/** The probability the table gives the option it picks in a choice question. */
const PICK = 0.97;

function expand(question: Question, value: Row[string] | undefined): Answer {
  if (value === undefined) throw new Error(`the table has no answer for "${question.id}"`);
  if (question.kind === "predicate") return { kind: "predicate", yes: Number(value) };
  if (question.kind === "score") return { kind: "score", score: Number(value) };
  const [option, p] = Array.isArray(value) ? value : [value, PICK];
  const rest = (1 - Number(p)) / (question.options.length - 1);
  return { kind: "choice", probs: Object.fromEntries(question.options.map((o) => [o, o === option ? p : rest])) };
}

/** Throws on a question whose text names another question of the same request, as `{month}` names the question `month`. */
function rejectDependents(questions: Question[]): void {
  const ids = new Set(questions.map((q) => q.id));
  for (const { id, ask } of questions) {
    const named = [...ask.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "");
    const same = named.find((other) => ids.has(other));
    if (same !== undefined) throw new Error(`question "${id}" refers to "${same}", which is in the same request`);
  }
}

/** A deterministic `DecideClient` over `rows`, keyed by state. `requests` lists the questions of every request. */
export function tableClient(rows: Record<string, Row>): DecideClient & { requests: Question[][] } {
  const requests: Question[][] = [];
  return {
    requests,
    async decide(state, questions) {
      rejectDependents(questions);
      requests.push(questions);
      const row = rows[state] ?? {};
      return Object.fromEntries(questions.map((q) => [q.id, expand(q, row[q.id])]));
    },
  };
}

/** The probability an answer gives `option`: `yes` or `no` for a predicate, a listed option for a choice. */
export function probabilityOf(answer: Answer | undefined, option: string): number {
  if (answer?.kind === "predicate") return option === "yes" ? answer.yes : 1 - answer.yes;
  if (answer?.kind === "choice") return answer.probs[option] ?? 0;
  throw new Error("a score has no option to read");
}

/** The most probable option of a choice answer. */
export function topOption(answer: Answer | undefined): string {
  if (answer?.kind !== "choice") throw new Error("only a choice has a most probable option");
  return Object.entries(answer.probs).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}
