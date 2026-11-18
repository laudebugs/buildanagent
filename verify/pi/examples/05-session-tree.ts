// Sessions are a tree: continuing from an earlier entry adds a branch and keeps the old one.
// Docs: how-pi-works.md "Sessions", sdk.md "Session storage", session-format.md "Tree Structure"
import { check, fauxAssistantMessage, fauxSession, fauxText } from "./lib/faux.ts";

const { session } = await fauxSession(
  [
    fauxAssistantMessage(fauxText("Plan A.")),
    fauxAssistantMessage(fauxText("Refined plan A.")),
    fauxAssistantMessage(fauxText("Plan B.")),
  ],
  { tools: [] },
);
const sm = session.sessionManager;
try {
  await session.prompt("Propose a plan.");
  const firstAnswerId = sm.getLeafId();
  check(firstAnswerId, "the first answer has an entry id");
  await session.prompt("Refine it.");
  check(sm.getBranch().length >= 4, "active branch holds both exchanges");

  // Branch from the first answer and continue down a different path.
  sm.branch(firstAnswerId);
  check(sm.getLeafId() === firstAnswerId, "branch() moves the active leaf back");
  await session.prompt("Try something else.");

  const texts = (entries: unknown[]) => JSON.stringify(entries);
  check(
    texts(sm.getEntries()).includes("Refined plan A.") && texts(sm.getEntries()).includes("Plan B."),
    "both branches stay in the session",
  );
  check(!texts(sm.getBranch()).includes("Refined plan A."), "the active branch excludes the abandoned path");
  const ids = new Set(sm.getEntries().map((e) => e.id));
  check(
    sm.getEntries().every((e) => e.parentId === null || ids.has(e.parentId)),
    "every entry points at a parent in the same tree",
  );
  const children = sm.getEntries().filter((e) => e.parentId === firstAnswerId);
  check(children.length === 2, "the branch point has two children");
} finally {
  session.dispose();
}
