// A search tool that ranks a small fixture of support documents with BM25, and four checks on where keyword search
// works and where it fails. BM25 is written in this file (no search package and no embedding API): a document's score
// for a query is the sum, over the query's words, of the word's rarity in the corpus times how often the document uses
// it, damped for repetition and for a long document. The tool searches fixtures/support-docs.json, ten documents from
// two tenants. The model is scripted, so the example tests the retriever and what reaches the model, not a model's
// judgement. Its second turn is defined to repeat the advice of the first search result, which makes the last check
// concrete: whatever ranks first is what the model reads.
// Checks: an exact identifier ranks its document first; a paraphrase that shares no words with its document finds
// nothing; a tenant filter applied before ranking keeps the other tenant's near-duplicate out; and a planted document
// that stuffs the query's words outranks the real one and steers the scripted answer.
// Docs: ai-sdk-core/tools-and-tool-calling.mdx
import { readFileSync } from "node:fs";
import { generateText, isStepCount, tool } from "ai";
import { z } from "zod";
import { check, scripted } from "./lib/check.ts";

type Doc = { id: string; tenant: string; title: string; text: string };
const corpus: Doc[] = JSON.parse(readFileSync("support-docs.json", "utf8"));

// #region bm25
const K1 = 1.2; // how fast repeating a word stops adding to the score
const B = 0.75; // how strongly a long document is marked down

const words = (text: string): string[] => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Ranks `docs` for `query`, best first; a document that shares no word with the query is left out. */
function bm25(docs: Doc[], query: string): { doc: Doc; score: number }[] {
  const tokens = docs.map((d) => words(`${d.title} ${d.text}`));
  const avgLength = tokens.reduce((sum, t) => sum + t.length, 0) / docs.length;
  const ranked = docs.map((doc, i) => {
    let score = 0;
    for (const word of new Set(words(query))) {
      const withWord = tokens.filter((t) => t.includes(word)).length;
      if (withWord === 0) continue;
      const rarity = Math.log(1 + (docs.length - withWord + 0.5) / (withWord + 0.5));
      const count = tokens[i].filter((t) => t === word).length;
      score += (rarity * count * (K1 + 1)) / (count + K1 * (1 - B + (B * tokens[i].length) / avgLength));
    }
    return { doc, score };
  });
  return ranked.filter((r) => r.score > 0).sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id));
}
// #endregion

/** What the search tool did, so the checks read the calls and arguments rather than the model's words. */
const searches: { tenant: string; query: string; ids: string[] }[] = [];

// #region search-tool
/** A search tool for one tenant. The tenant comes from the session, never from the model, and filters before ranking. */
function searchTool(tenant: string, docs: Doc[] = corpus) {
  return tool({
    description: "Search the support documents for the words in the query. Returns up to three documents, best first.",
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => {
      const hits = bm25(
        docs.filter((d) => d.tenant === tenant), // book:note filter-first
        query,
      ).slice(0, 3);
      searches.push({ tenant, query, ids: hits.map((h) => h.doc.id) });
      return hits.map((h) => ({
        id: h.doc.id,
        title: h.doc.title,
        text: h.doc.text,
        score: Number(h.score.toFixed(2)),
      }));
    },
  });
}
// #endregion

/** Runs a one-search agent: the scripted model searches for `query`, then answers with the first result's text. */
async function ask(query: string, tenant: string, docs: Doc[] = corpus) {
  const { model, requests } = scripted((n) => {
    if (n === 0) return { tools: [{ name: "search_docs", input: { query } }] };
    const results = JSON.stringify(requests[n].prompt.at(-1)?.content); // the tool result, as the model received it
    const first = /"text":"([^"]+)"/.exec(results)?.[1];
    return first ? `The documents say: ${first}` : "The documents have nothing on that.";
  });
  const result = await generateText({
    model,
    prompt: query,
    tools: { search_docs: searchTool(tenant, docs) },
    stopWhen: isStepCount(3),
  });
  return { result, requests };
}

const ids = (hits: { doc: Doc }[]) => hits.map((h) => h.doc.id);
const acme = corpus.filter((d) => d.tenant === "acme");

check(corpus.length === 10, "the fixture holds ten documents");

// 1. An exact identifier is rare, so the one document that holds it ranks first and alone.
const byCode = bm25(acme, "E4021");
check(ids(byCode).join() === "kb-01", "the identifier E4021 finds only its document, kb-01");
const byCodeRun = await ask("What does E4021 mean?", "acme");
check(
  JSON.stringify(searches.at(-1)) ===
    JSON.stringify({ tenant: "acme", query: "What does E4021 mean?", ids: ["kb-01"] }),
  "the tool searched for the question and returned kb-01",
);
check(byCodeRun.result.text.includes("storage quota is full"), "the scripted answer repeats kb-01");

// 2. A paraphrase shares no word with the document that answers it, so keyword search returns nothing.
const sameWords = bm25(acme, "reset my password");
const paraphrase = bm25(acme, "I forgot my login credentials");
check(ids(sameWords)[0] === "kb-02", "a query in the document's own words ranks kb-02 first");
check(paraphrase.length === 0, "a paraphrase of the same need matches no document");
const missRun = await ask("I forgot my login credentials", "acme");
check(missRun.result.text === "The documents have nothing on that.", "the scripted model is left with no result");

// 3. A tenant filter applied before ranking keeps another tenant's near-duplicate out of the results.
const both = ids(bm25(corpus, "E4021 storage quota"));
check(both.includes("kb-01") && both.includes("kb-06"), "unfiltered, both tenants' E4021 documents match");
const globexRun = await ask("E4021 storage quota", "globex");
const acmeRun = await ask("E4021 storage quota", "acme");
check(
  searches.at(-2)?.tenant === "globex" && searches.at(-2)?.ids.join() === "kb-06",
  "a globex search returns kb-06 and no acme document",
);
check(
  searches.at(-1)?.tenant === "acme" && !searches.at(-1)?.ids.includes("kb-06"),
  "an acme search never returns kb-06, the globex document",
);
check(
  globexRun.result.text.includes("billing portal") && !acmeRun.result.text.includes("billing portal"),
  "each tenant's answer comes from its own document",
);

// #region planted
// 4. A document that repeats the query's words outranks the real answer, and what ranks first is what the model reads.
const question = "How do I fix a failed export?";
const plantedRun = await ask(question, "acme");
const topHit = bm25(acme, question)[0]?.doc.id;
check(topHit === "kb-10", "the planted document ranks first for the question"); // book:note planted
check(
  plantedRun.result.text.includes("https://cleanup.example/run"),
  "the scripted answer follows the planted document's instruction",
);
const withoutPlant = await ask(
  question,
  "acme",
  corpus.filter((d) => d.id !== "kb-10"),
);
check(
  withoutPlant.result.text.includes("storage quota is full"),
  "with the planted document removed, the same question gets kb-01's answer",
);
// #endregion

// Every request offered the model only the search tool, and it never called anything else.
const offered = [byCodeRun, missRun, globexRun, acmeRun, plantedRun, withoutPlant].flatMap((r) => r.requests);
check(
  offered.every((r) => r.tools?.length === 1 && r.tools[0].type === "function" && r.tools[0].name === "search_docs"),
  "every model request offered only the search_docs function tool",
);
