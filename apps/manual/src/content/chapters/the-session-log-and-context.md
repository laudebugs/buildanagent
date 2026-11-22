---
title: "The session log and context policy"
summary: A session log that keeps every entry in one append-only tree lets a harness fork, resume and shorten what the model sees without losing anything. This chapter shows why one tree of typed entries suits that job, how HEAD, a fork and a writer lock keep it safe, how five context layers shorten the context cheapest first while compaction stays visible and reversible, and how a progress file carries long work across windows.
opening: analogy
sources: [pi-session-format, pi-sessions, pi-session-manager, hou-messy-middle, wong-governed-ml, buildanagent-harness-readme, buildanagent-harness-plan]
glossary: [session-log, session]
switchTo: [N2, N3, N4, N5, N6, N7, N8, N9, N10]
---

You are ten, holding a choose-your-own-adventure book, and on page 14 you open the cave door. Page 31 says the troll eats you. You keep a finger in page 14, flip back and take the tunnel instead. When you close the book, every path is still printed in it, the troll's page included, and a friend who opens it tomorrow can follow any of them.

A harness's session log works like :analogy[that book]{#adventure-book}. [[ch:memory-and-sessions]] treated a session as a chart that one run writes and the next run reads. This chapter opens the chart and looks at its pages. Each page is an entry that names the entry it follows. Going back to an earlier entry writes nothing, and the next entry written there starts a second path beside the first. The book differs in who turns the pages: here the harness or the user forks, every path stays readable to them, and the model sees only the path being followed.

By the end of the chapter you can say why one append-only tree of typed entries is the right shape for a session log, how a layered context policy shortens what the model sees without deleting an entry, and how a long task outlives any one window by keeping its state in files. The last exercise has you fork a session, compact one branch and show that the other is unchanged. Our own harness builds the log, so its parts appear by name, and its context layers are a design that our plan describes, not shipped code. The listings come from Pi and Cloudflare Agents, whose examples run offline here.

## One append-only tree of typed entries keeps every path, so going back erases nothing

Pi, a coding-agent harness, stores a session as a JSONL file with one JSON object per line, and it links the lines into a tree: every entry carries an `id` and a `parentId`, so a new branch needs no new file [@pi-session-format]. [[lst:session-tree-pi]] builds a two-branch tree from three scripted answers.

:::listing[Branching from the first answer leaves both paths in the session]{#session-tree-pi file="verify/pi/examples/05-session-tree.ts" region="tree" replay}
::note[`getLeafId()` returns the id of the entry that the next prompt will follow. Pi calls it the leaf, the current position in the tree. After the first answer, it names that answer.]{#first-answer}
::note[`branch()` moves the leaf back to an earlier entry and writes nothing. Pi's own comment says "Existing entries are not modified or deleted."]{#branch}
::note[Two entries now name the first answer as their parent: the abandoned "Refine it." and the new "Try something else.". That is a fork.]{#children}
:::

The replay shows what the model receives. The second request resends the system prompt, the first question and the first answer, then adds "Refine it." The third request, sent after `branch()`, resends the same three messages and adds "Try something else." It carries neither "Refine it." nor "Refined plan A.", yet the example's checks on lines 28 to 32 find both still in the session's entries. Pi's guide says it in two sentences: "Pi stores entries as a tree, so returning to an earlier point does not erase the branch you leave", and "The model receives the active branch, not every branch in the session file" [@pi-sessions].

A tree of messages alone would not be enough, because messages are only one of Pi's entry types. The file also holds `model_change`{checked=row-3}, `thinking_level_change`{checked=row-3} and `usage`{checked=row-3} entries, and the `compaction`{checked=row-3}, `context_edit`{checked=row-3} and `branch_summary`{checked=row-3} entries that the later sections use [@pi-session-format]. Each of those three adds history instead of rewriting it. A `context_edit`{checked=row-3} hides an earlier entry from the model's context while "the target entry and its metadata remain unchanged in raw history", and its edits are "branch-relative: navigating to a point before the edit reveals the target's original contribution again" [@pi-session-format]. Typing the entries pays off in reversal: to undo a change, you choose a path that does not include it.

Our harness takes the same shape and makes it stricter. Every entry in its log carries an `id`, a `parentId`{checked=row-10}, a position number `seq`{checked=row-10}, a timestamp, a `type`{checked=row-10} and an `origin`{checked=row-10} that says whether the user, the operator, the model, a tool or the harness produced it [@buildanagent-harness-readme]. One model call writes one `message_block`{checked=row-11} entry for each content block, then a `message_end`{checked=row-11} and a `usage`{checked=row-11} entry. A finished tool call writes a `tool_result`{checked=row-11} entry, and streamed deltas reach live clients but are never stored. The per-block grain lets a tool result sit between two calls of one message, which a per-message line cannot do [@buildanagent-harness-plan]. As of November 2026 the plan keeps that grain provisional until a test compares per-delta, per-block and per-message logs.

Why keep every entry instead of the winning path? Two recent papers bear on the question, and neither settles it. Hou and colleagues argue that datasets of agent output keep patches and commits but structurally cannot hold failed retries, fallbacks or abandoned sessions [@hou-messy-middle]. Theirs is a six-page position paper whose only evidence is one 93-day deployment, which the authors call "a design probe, not a validation study". Wong computes governance metrics from an append-only ledger in which a control plane writes every trial, over six tasks and 1,445 trials [@wong-governed-ml]. Neither paper tests a session tree. In our reading, a log that keeps abandoned paths and retried calls holds the record they say is missing, and our harness writes a `usage`{checked=row-11} entry for each retried model call, so a retry shows in a session's cost even when its text does not [@buildanagent-harness-readme].

A tree that never deletes makes the next two sections possible. A fork is one more child of an old entry, and a compaction is one more entry on a path.

## Exercises

1. Placeholder, written with the last section.
