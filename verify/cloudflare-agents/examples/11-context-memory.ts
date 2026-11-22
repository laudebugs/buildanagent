// Long-term memory in an agent's own SQLite: a writable block and a full-text search block from `agents/context`.
// A scripted model writes a fact to each block through the set_context tool, the Durable Object is evicted, and on
// the new instance the system prompt holds the fact from the memory block, and a second scripted model finds the note
// in the search block through search_context. A second agent name, which has its own database, sees neither block's
// content: both blocks render there with their headers and no text. FTS5 ran in local
// workerd with `tokenize='porter unicode61'`, so a query with other word forms still matches. `agents/context` is
// experimental as of November 2026: the docs say every export "may change between releases".
// Docs: agents/docs/agents/context.md ("Providers", "Durable SQLite blocks", "Searchable blocks", "Tools").
import { Agent, getAgentByName } from "agents";
import { AgentContextProvider, AgentSearchProvider, ContextBlocks } from "agents/context";
import { generateText, stepCountIs } from "ai";
import { check, type Harness, rpc, scripted, type Turn } from "./lib/check.ts";

type Env = { Notebook: DurableObjectNamespace<Notebook> };

export class Notebook extends Agent<Env> {
  // #region context-blocks
  context = new ContextBlocks([
    // get() + set(): a writable block, which the model changes through set_context.
    { label: "memory", description: "Facts about the user", maxTokens: 500, provider: new AgentContextProvider(this) },
    // get() + search() + set(): a searchable block, which the model fills with set_context and queries with search_context.
    { label: "notes", description: "Notes to search later", provider: new AgentSearchProvider(this) },
  ]);

  /** One run: the frozen system prompt and the blocks' tools go to a model that plays `script`. */
  async run(prompt: string, script: Turn[]) {
    const { model, requests } = scripted(script);
    const result = await generateText({
      model,
      system: await this.context.freezeSystemPrompt(), // book:note frozen
      tools: await this.context.tools(), // book:note tools
      prompt,
      stopWhen: stepCountIs(4),
    });
    const calls = result.steps.flatMap((s) => s.toolCalls.map((c) => ({ name: c.toolName, input: c.input })));
    const outputs = result.steps.flatMap((s) => s.toolResults.map((r) => String(r.output)));
    const system = requests[0].prompt.find((m) => m.role === "system");
    return {
      text: result.text,
      calls,
      outputs,
      system: system?.content ?? "",
      offered: (requests[0].tools ?? []).map((t) => t.name).sort(),
      modelCalls: requests.length,
    };
  }
  // #endregion context-blocks

  /** The rows the blocks keep in this agent's own database, read without the blocks. */
  rows() {
    const tables = this.sql<{
      name: string;
      sql: string;
    }>`SELECT name, sql FROM sqlite_master WHERE name LIKE 'cf_agents_%'`;
    const blocks = tables.some((t) => t.name === "cf_agents_context_blocks")
      ? this.sql<{ label: string; content: string }>`SELECT label, content FROM cf_agents_context_blocks`
      : [];
    const notes = tables.some((t) => t.name === "cf_agents_search_fts")
      ? this.sql<{ label: string; key: string }>`SELECT label, key FROM cf_agents_search_fts`
      : [];
    return { blocks, notes, fts5: tables.find((t) => t.name === "cf_agents_search_fts")?.sql ?? "" };
  }
}

const FACT = "Ada prefers metric units";
const NOTE = "The staging deploy runs on Thursdays after the freeze review";

// #region scripts
/** First run: write one fact to each block. Nothing is read back yet. */
const teach: Turn[] = [
  {
    tools: [
      { name: "set_context", input: { label: "memory", content: FACT } },
      { name: "set_context", input: { label: "notes", content: NOTE, metadata: { title: "Deploy day" } } },
    ],
  },
  "Saved both.",
];
/** Later run: search the notes with other word forms than the note holds, then answer. */
const recall: Turn[] = [
  { tools: [{ name: "search_context", input: { label: "notes", query: "deploying thursday" } }] },
  "Done.",
];
// #endregion scripts

const QUESTION = "When does staging deploy, and what does Ada prefer?";

export async function test(env: Env, h: Harness) {
  const stub = async (name: string) => rpc<Notebook>(await getAgentByName(env.Notebook, name));
  const first = await (await stub("desk")).run(
    "Remember that Ada prefers metric units, and when staging deploys.",
    teach,
  );
  check(first.offered.join() === "search_context,set_context", "the model is offered only the two context tools");
  check(first.calls.length === 2 && first.calls.every((c) => c.name === "set_context"), "it wrote through set_context");
  check(first.outputs[0]?.startsWith("Written to memory."), `the writable block took the write: ${first.outputs[0]}`);
  check(
    first.outputs[1] === 'Indexed "deploy-day" in notes.',
    `the search block indexed the note: ${first.outputs[1]}`,
  );
  check(!first.system.includes(FACT), "the frozen system prompt was rendered before the write, so it lacks the fact");
  const stored = await (await stub("desk")).rows();
  check(
    stored.blocks.length === 1 && stored.blocks[0].content === FACT,
    "the fact is a row in cf_agents_context_blocks",
  );
  check(
    /fts5/i.test(stored.fts5) && stored.notes.length === 1,
    "the note is a row of an FTS5 table, which workerd ran",
  );

  // #region evict-and-recall
  await h.evict("Notebook", "desk");
  const woke = await (await stub("desk")).run(QUESTION, recall);
  // #endregion evict-and-recall
  check(woke.system.includes(FACT), "after eviction the new instance renders the written fact into its system prompt");
  check(woke.system.includes("1 entries indexed."), "and renders the search block's count of entries");
  check(
    woke.calls.length === 1 && woke.calls[0].name === "search_context",
    "the model searched through search_context",
  );
  check(
    woke.outputs.at(0) === `[deploy-day]\n${NOTE}`,
    "the search found the note, though the query used other word forms",
  );

  const other = await stub("other");
  const asked = await other.run(QUESTION, recall);
  check(
    asked.system.includes("MEMORY (Facts about the user)") &&
      asked.system.includes("NOTES (Notes to search later)") &&
      !asked.system.includes(FACT) &&
      !asked.system.includes("entries indexed"),
    "a second agent name sees both block headers and neither block's content",
  );
  check(asked.outputs.at(0) === "No results found.", "and the same query finds nothing there");
  const otherRows = await other.rows();
  check(otherRows.blocks.length === 0 && otherRows.notes.length === 0, "its database holds no block row and no note");
}
