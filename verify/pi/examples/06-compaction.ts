// Manual compaction appends a summary entry; the originals stay in the session tree.
// With keepRecentTokens: 1 the cut lands inside the last user-message span, so Pi makes two
// summary requests (history + span prefix) and merges them, as compaction.md describes.
// Docs: compaction.md "How It Works", "Split user-message spans"; how-pi-works.md "Sessions"
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { check, fauxAssistantMessage, fauxSession, fauxText } from "./lib/faux.ts";

let nextRequest = "";
const { session } = await fauxSession(
  [
    fauxAssistantMessage(fauxText("The capital of France is Paris.")),
    fauxAssistantMessage(fauxText("The capital of Japan is Tokyo.")),
    fauxAssistantMessage(fauxText("SUMMARY: user asked about capitals of France and Japan.")), // history summary
    fauxAssistantMessage(fauxText("PREFIX: the last span asked about Japan.")), // split-span prefix summary
    (ctx) => {
      nextRequest = JSON.stringify(ctx.messages);
      return fauxAssistantMessage(fauxText("Noted."));
    },
  ],
  // keepRecentTokens: 1 makes even a tiny conversation compactable.
  { tools: [], settingsManager: SettingsManager.inMemory({ compaction: { keepRecentTokens: 1 } }) },
);
const sm = session.sessionManager;
try {
  await session.prompt("Capital of France?");
  await session.prompt("Capital of Japan?");
  const before = sm.getEntries().length;
  const result = await session.compact();
  check(
    typeof result.summary === "string" && result.summary.includes("SUMMARY"),
    "compact() returns the model's summary",
  );
  check(
    result.summary.includes("PREFIX") && result.summary.includes("split turn"),
    "a split span gets a second summary, merged in",
  );
  const compaction = sm.getEntries().find((e) => e.type === "compaction");
  check(compaction, "a compaction entry is appended to the session");
  check(sm.getEntries().length === before + 1, "no original entries are removed");
  await session.prompt("Thanks.");
  check(nextRequest.includes("SUMMARY: user asked about capitals"), "the next request carries the summary");
  check(!nextRequest.includes("The capital of France is Paris."), "the next request drops the summarised messages");
} finally {
  session.dispose();
}
