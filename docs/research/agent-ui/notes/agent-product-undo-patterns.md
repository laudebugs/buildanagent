# Undo and review patterns for agent edits in real products (as of November 2026)

*Working material for the [undo report](../undo-agent-edits.md); the report and its [fact-check log](../fact-check.md#undo-for-agent-edits-report-2026-11-18) supersede this note where they disagree.*

Fetched 2026-11-18 with `curl` unless noted. "Search summary" marks claims taken from WebSearch result summaries whose primary page could not be read (support.microsoft.com and www.notion.com pages render their bodies client-side or were unreachable from WebFetch in this session; curl got the HTML shell but not the relevant text). Treat those as secondary until re-checked in a browser.

Patterns found, used as labels below:
- **P1 Pending-review working set**: edits are written to disk but marked pending; the user Keeps or Undoes per hunk, per file or all.
- **P2 Pre-apply diff approval**: the edit is shown as a proposal and is not written until accepted.
- **P3 Per-turn checkpoint / rewind**: a snapshot before each prompt or tool call; restore files, conversation or both.
- **P4 Preview-then-apply card**: a plan or action card the user applies, followed by an Undo button.
- **P5 Direct edit + host undo / version history**: the agent edits directly; recovery is the host app's Ctrl+Z or version history.
- **P6 Confirm before external write**: irreversible side effects (send email) require explicit confirmation.
- **P7 Undo toast with a time window**: Gmail-style delayed commit.

## Coding agents in editors

### Takeaway
Every major coding agent now ships both a review layer (per-hunk Keep/Undo or accept/reject) and a per-turn checkpoint layer, and every vendor's docs say the same thing about limits: checkpoints cover only files touched by the agent's own edit tools, not shell commands, subagents or external services, and they are not a substitute for Git.

### Cited Findings

**Claude Code (CLI and VS Code extension)**
- Checkpoint granularity is per prompt: "checkpointing automatically captures the state of your code before each prompt you send that starts a turn." `/rewind` (alias `/undo`) or double Esc opens the menu — [Claude Code checkpointing](https://code.claude.com/docs/en/checkpointing.md)
- Rewind menu actions: Restore code and conversation; Restore conversation; Restore code; Summarize from here; Summarize up to here; Never mind. Code-restore options appear only when the checkpoint has tracked file changes — [checkpointing](https://code.claude.com/docs/en/checkpointing.md)
- Retention: snapshots for the 100 most recent checkpoints per session; checkpoints persist across resume; snapshots deleted by the retention sweep ~30 days after last save (`cleanupPeriodDays`), after which rewind can fail with "No files were restored" — [checkpointing](https://code.claude.com/docs/en/checkpointing.md)
- Limits: a file changed only by Bash isn't tracked ("use version control, such as Git"); background subagent edits are not restored except to files Claude already edited; external/concurrent edits not captured; messages queued mid-turn get no checkpoint ("No code restore"); symlinked and hard-linked paths skipped with a "Restored the code, but skipped N files" warning; "Not a replacement for version control" — [checkpointing](https://code.claude.com/docs/en/checkpointing.md)
- The docs do not claim rewind reverts external side effects (network calls, deployments); the only stated scope is file edits by Claude's editing tools — [checkpointing](https://code.claude.com/docs/en/checkpointing.md) (inference from absence; see Inferences)
- VS Code extension, Manual mode: a side-by-side diff is shown before the write and "You can accept, reject, or tell Claude what to do instead"; if the user edits the proposal, Claude "is told that you modified it" (P2) — [Claude Code VS Code](https://code.claude.com/docs/en/vs-code.md)
- Per-change review: **Accept this change / Reject this change** under each change; rejecting reverts it in the proposed content; requires v2.1.275+; "A diff with more than 100 changes opens without the per-change buttons" — [Claude Code VS Code](https://code.claude.com/docs/en/vs-code.md)
- VS Code checkpoints: hover a message for rewind; options include "Rewind code to here" and "Fork conversation and rewind code" — [Claude Code VS Code](https://code.claude.com/docs/en/vs-code.md)
- Branching alternative to rewind: `/branch` or `claude --continue --fork-session` preserves the original session — [checkpointing](https://code.claude.com/docs/en/checkpointing.md)

**GitHub Copilot / VS Code agents**
- Working set (P1): "Keep retains the changes and clears their pending-review state. Undo reverts them without rewinding the agent conversation." — [VS Code: Review and revert agent changes](https://code.visualstudio.com/docs/copilot/chat/review-code-edits)
- "Pending edits are already saved to disk", so tests run against them; "Keep doesn't stage or commit them"; staging in Source Control auto-keeps the edits — [VS Code review page](https://code.visualstudio.com/docs/copilot/chat/review-code-edits)
- Granularity: Keep/Undo per change, per file, or all files — [VS Code review page](https://code.visualstudio.com/docs/copilot/chat/review-code-edits)
- Limit: "The working set only tracks changes from supported agent edit tools"; terminal/script changes don't appear. The editor working set is marked "experimental and might change or be removed" — [VS Code review page](https://code.visualstudio.com/docs/copilot/chat/review-code-edits)
- Harness split: for Claude or Codex harness sessions, the Agents window and cloud sessions, users "compare diffs instead of keeping or undoing pending edits"; the Local harness is deprecated, removal February 2027 — [VS Code review page](https://code.visualstudio.com/docs/copilot/chat/review-code-edits)
- Recovery-scope table (the clearest official taxonomy found): Undo pending edits (change/file/all, no conversation rewind); Edit a previous request (reverts that and later requests' file changes, resends); Restore a checkpoint (files + removes later turns); Discard with Source Control; "Use an external service's recovery controls" for deployments, issues, databases — [VS Code review page](https://code.visualstudio.com/docs/copilot/chat/review-code-edits)
- Checkpoints on by default (`chat.checkpoints.enabled`), snapshot "before processing each request"; restore requires confirmation. "It doesn't reverse completed terminal commands, network requests, deployments, or changes that tools made to external services." — [VS Code review page](https://code.visualstudio.com/docs/copilot/chat/review-code-edits)
- Auto-accept: `chat.editing.autoAcceptDelay` keeps pending edits after a delay; hovering stops the countdown; docs advise reviewing before commit if you auto-keep — [VS Code review page](https://code.visualstudio.com/docs/copilot/chat/review-code-edits)

**Cursor**
- Checkpoints: "Agent automatically creates them before making significant changes"; click a checkpoint in the timeline to preview files, then restore; also a `Restore Checkpoint` button on previous requests — [Cursor Agent overview](https://cursor.com/docs/agent/overview.md)
- "Restoring a checkpoint reverts files only; it does not remove messages from the conversation." Stored locally, separate from Git; "use Git for permanent version control" — [Cursor Agent overview](https://cursor.com/docs/agent/overview.md)
- Cursor also offers post-hoc "Agent Review" (`/agent-review`, automatic after every commit, or from Source Control against main), Quick vs Deep depth — [Cursor Agent Review](https://cursor.com/docs/agent/agent-review.md). This is an AI reviewer, not a human Keep/Undo control.
- A Cursor forum thread title reports "Rollback doesn't restore previous chat state and files remain in Git Changes" — [Cursor forum](https://forum.cursor.com/t/rollback-doesn-t-restore-previous-chat-state-and-files-remain-in-git-changes/170624/9.md) (user report, not verified; surfaced via search)

**Windsurf / Devin Desktop (Cognition)**
- Revert per step: hover the original prompt and click the revert arrow, or revert from the table of contents; reverts "all code changes back to the state of your codebase at the desired step" — [Windsurf Cascade docs](https://docs.windsurf.com/windsurf/cascade/cascade)
- Warning: "Reverts are currently irreversible, so be careful!" — [Windsurf Cascade docs](https://docs.windsurf.com/windsurf/cascade/cascade)
- Named checkpoints: users can create a named snapshot from the conversation and revert to it later — [Windsurf Cascade docs](https://docs.windsurf.com/windsurf/cascade/cascade)
- Diff zones: inline highlighted regions "with accept and reject controls for each hunk", on by default; when disabled, "agent edits are applied directly to the file" with only a dismiss button — [Windsurf advanced docs](https://docs.windsurf.com/windsurf/advanced) (the page now calls the product "Devin Desktop" and "Devin Settings", as of November 2026)

**Zed agent panel**
- Panel surfaces edited files/line counts; `Review Changes` (ctrl-shift-r) opens a multi-buffer tab; "You can accept or reject each individual change hunk, or the whole set of changes made by the agent." — [Zed Agent Panel](https://zed.dev/docs/ai/agent-panel.md)
- Optional inline per-file keep/reject via `agent.single_file_review: true`, which "temporarily overrides the buffer's git diff while review is active" — [Zed Agent Panel](https://zed.dev/docs/ai/agent-panel.md)
- Fetched Zed page does not mention checkpoints (grep for "checkpoint" returned nothing) — [Zed Agent Panel](https://zed.dev/docs/ai/agent-panel.md)

**Cline**
- Granularity is per tool use (finer than per turn): "Every time Cline modifies a file or runs a command, it saves a snapshot"; stored in a shadow Git repo, "Your main Git repository stays untouched", includes files not tracked by Git, persists across editor sessions — [Cline Checkpoints](https://docs.cline.bot/core-workflows/checkpoints.md)
- Compare (editor diff) and Restore buttons on each checkpoint; Restore Files / Restore Task Only / Restore Files & Task — [Cline Checkpoints](https://docs.cline.bot/core-workflows/checkpoints.md)
- Explicit design argument that undo replaces confirmation: "Instead of carefully reviewing every change before approving, you can let Cline move fast and roll back"; "Checkpoints make auto-approve practical." (vendor opinion) — [Cline Checkpoints](https://docs.cline.bot/core-workflows/checkpoints.md)
- Warning: large repos may use significant storage and slow Cline — [Cline Checkpoints](https://docs.cline.bot/core-workflows/checkpoints.md)
- Editing a previous message with "Restore All" restores files to that checkpoint then resubmits — [Cline Checkpoints](https://docs.cline.bot/core-workflows/checkpoints.md)

**JetBrains Junie / AI Assistant**
- Junie (AI Assistant 2026.2 help): review by clicking the modified file; Rollback per file (hover icon) or "To roll back changes in all files, click Rollback." — [JetBrains Junie agent help](https://www.jetbrains.com/help/ai-assistant/junie-agent.html)
- AI Assistant agents "introduce more complex changes across multiple files, which you can review and accept or discard"; chat mode code "needs to be reviewed and applied manually" — [JetBrains AI chat](https://www.jetbrains.com/help/ai-assistant/ai-chat.html)
- A blog test reports Junie rollback is still possible for the most recent change after a follow-up instruction — [Zenn blog (Japanese)](https://zenn.dev/nattosystem_jp/articles/b510c3dd3240c2) (secondary, via search summary)

**Other checkpoint implementations surfaced in search (not fetched)**: Kilo Code checkpoints depend on git-based snapshots — [Kilo docs](https://kilo.ai/docs/features/checkpoints); Salesforce Agentforce for Developers uses a shadow Git repo — [Salesforce](https://developer.salesforce.com/docs/platform/einstein-for-devs/guide/checkpoints.html) (both search summary).

### Inferences
- Two independent axes exist and products combine them: **review state** (pending vs kept, per hunk/file/all) and **time travel** (checkpoint per turn or per tool call). VS Code is the only one that documents both plus how they interact (staging = keep; Source Control discard = discard pending).
- Granularity ladder: hunk (Zed, VS Code, Claude VS Code, Windsurf diff zones) → file (Junie, VS Code) → tool call (Cline) → turn/prompt (Claude Code, VS Code, Windsurf, Cursor "before significant changes") → named checkpoint (Windsurf) → Git.
- Whether conversation rewinds with code differs: Cursor restores files only; Claude Code and Cline offer code / conversation / both; VS Code restore removes later turns; VS Code Undo pending edits leaves conversation.
- No coding product documents reverting external side effects. VS Code says so explicitly; Claude Code and Cursor imply it by scoping checkpoints to file edits. Cline's per-command snapshot captures file state after commands but cannot undo what the command did elsewhere (inference).
- "Undo the undo" is rarely documented: Windsurf warns reverts are irreversible; Claude Code notes rewound messages can return on exit before the next prompt; others are silent.

### Gaps
- Cursor's per-file/per-hunk Keep/Undo (Accept/Reject) review UI is not described in the fetched Cursor overview page; cursor.com/llms.txt lists no dedicated review-diffs page. Not verified as of November 2026.
- GitHub Copilot cloud agent (PR-based) undo is outside these pages; the PR itself is the review unit (see repo's earlier agent-UI report).
- Zed checkpoints/restore: not found in current docs.

## Document, design and productivity tools

### Takeaway
Office-style agents mostly edit directly and fall back to the host app's undo and version history (P5), with Track Changes, preview cards or plan approval as opt-in front gates; only Google Sheets documents a dedicated post-action Undo button, and Notion and Gmail-connected agents add confirmation for irreversible external writes.

### Cited Findings
- **Google Sheets (Gemini)**: action edits produce an "Action preview card"; user clicks Apply; after completion "the Settings and Undo buttons show"; "If the action doesn't give the result you want, click Undo." (P4) — [Collaborate with Gemini in Google Sheets](https://support.google.com/docs/answer/14356410?hl=en)
- Sheets: inserting a new tab shows a bottom-left confirmation "with an option to delete the newly inserted tab" (a toast-style undo, P7-like); plan cards are reviewed then Applied — [Google Sheets help](https://support.google.com/docs/answer/14356410?hl=en)
- **Apps Script Gemini**: code proposals shown as a diff with Accept All / Reject All; cannot accept a subsection — [Apps Script Gemini guide](https://developers.google.com/apps-script/guides/gemini) (search summary)
- **Word (Copilot)**: "Edit with Copilot" makes direct changes; revert via undo or prior versions; it "cannot turn on/off or accept/reject tracked changes" but respects Track Changes when on; in shared documents with Work IQ it previews suggested changes in chat and requires confirmation first — [Edit with Copilot in Word](https://support.microsoft.com/en-us/word/edit-with-copilot-in-word) (search summary; page body not readable here)
- Word generated content: keep, discard, or refine with a follow-up prompt — [Welcome to Copilot in Word](https://support.microsoft.com/en-us/word/welcome-to-copilot-in-word) (search summary)
- Word tracked-changes integration: Message Center MC1384426 lists public preview mid-May 2026 and GA early June 2026 for Copilot working with tracked changes and comments on Windows desktop and Mac — [MC1384426 mirror](https://mc.merill.net/message/MC1384426); [Microsoft 365 Copilot blog, April 2026](https://techcommunity.microsoft.com/blog/Microsoft365CopilotBlog/copilot-in-word-new-capabilities-for-document-workflows/4508974) (search summary; roadmap dates may have shifted)
- **Excel (Copilot edit mode, formerly "Agent Mode")**: three modes, edit/plan/chat; edit mode "can edit your workbook directly"; plan mode lets you "review and confirm the approach before starting"; the page has a "Review workbook change history" section — [Agent mode in Excel](https://support.microsoft.com/en-us/office/agent-mode-in-excel-a2fd6fe4-97ac-416b-b89a-22f4d1357c7a) (curl, partial text)
- Excel: revert via undo or "view prior versions at any time" — [Agent mode in Excel](https://support.microsoft.com/office/agent-mode-in-excel-a2fd6fe4-97ac-416b-b89a-22f4d1357c7a); [Excel Copilot FAQ](https://support.microsoft.com/en-gb/office/frequently-asked-questions-about-agent-mode-in-excel-1cfd906d-40b4-46be-8e2d-65b893e28a02) (search summary)
- Third-party claims: Ctrl+Z sometimes shows nothing to undo after Copilot changes; undo stack clears after save — [wisechecker](https://wisechecker.com/?p=30451) (secondary, unverified)
- **Notion Agent**: can send email via Gmail connector; "Write actions (like sending) will ask you to confirm before Notion Agent takes action." (P6) — [Notion Agent help](https://www.notion.com/help/notion-agent) (curl)
- Notion Agent changes can be undone "at any time" (translated help pages; English undo steps not retrieved) — [Notion Agent help, zh-tw](https://www.notion.com/zh-tw/help/notion-agent) (search summary); Notion page "version history" lets you "look back, track changes, or recover past work" — [Notion Agent help](https://www.notion.com/help/notion-agent) (curl)
- Notion plan mode: agents "won't make edits until you approve the plan" — [Review & approve plans before Notion AI runs](https://www.notion.com/de/help/review-and-approve-plans-before-notion-ai-runs) (search summary)
- **Gmail Undo Send** (the model for undo toasts): after send, "Message sent" with "Undo" or "View message"; cancellation period 5, 10, 20 or 30 seconds — [Gmail help](https://support.google.com/mail/answer/2819488?hl=en)

### Inferences
- Office suites treat the document's own undo stack and version history as the agent's undo, so agent undo is only as reliable as host undo (save clears stack; collaborative edits interleave).
- Irreversible external writes (send email) are gated by confirmation, not undo, in Notion; this matches NN/g's rule that confirmation is for actions that cannot be undone.
- Gmail's Undo Send works because send is actually delayed; a real agent "undo toast" for external actions needs the same deferred-commit design (inference).

### Gaps
- Figma AI, Canva, Superhuman, Linear agents, CRM/support agents that stage changes: not researched within the tool budget; no primary sources collected.
- Google Docs Gemini "suggestions" mode: not verified.
- Exact Word "Keep it" label: search did not confirm that wording; the official pages say "keep, discard or refine" per search summary.
- support.microsoft.com and notion.com pages must be re-read in a browser before the report cites their quoted wording.

## Design guidance and evidence on undo vs confirmation

### Takeaway
Guidance consistently prefers undo over confirmation for routine actions and reserves confirmation for irreversible, high-cost ones; empirical evidence shows users often accept AI output with little scrutiny, which argues for review-friendly undo plus explicit gates for irreversible side effects.

### Cited Findings
- HAX Guideline 9: "Make it easy to edit, refine, or recover when the AI system is wrong." Patterns: 9A switch classification decisions, 9B rich and detailed edits, 9C undo automated actions, 9E batch-editing data — [HAX G9](https://www.microsoft.com/en-us/haxtoolkit/guideline/support-efficient-correction/)
- HAX Pattern 9C: "Enable the user to revert to a previous state or undo the AI system's actions." Use when the system "proactively and automatically alters the user's input and might be wrong" — [HAX 9C](https://www.microsoft.com/en-us/haxtoolkit/pattern/g9-c-undo-automated-actions/)
- NN/g (Jakob Nielsen, published 2018-02-18): "Do not use confirmation dialogs for routine actions"; overuse means people "stop paying attention"; use confirmation before "actions with serious consequences"; "do go to great lengths to provide undo" — [NN/g Confirmation Dialogs](https://www.nngroup.com/articles/confirmation-dialog/)
- Perry et al. (CCS 2023): participants with an AI assistant "wrote significantly less secure code" and "were more likely to believe they wrote secure code" — [arXiv 2211.03622](https://arxiv.org/abs/2211.03622)
- Copilot session observation: programmers "accept the assistant's suggestions with minimal scrutiny" — attributed to a Saarland University report via search summary ([ccinfo.nl PDF](https://ccinfo.nl/_downloads/890af91dfe6cc5c3f4fdf635f2339b6d)); unverified, cite only after locating the paper
- Counter-evidence: an exploratory study found developers mostly treat suggestions as drafts and check them — [arXiv 2604.16393](https://arxiv.org/pdf/2604.16393) (search summary)
- Literature review: forcing engagement before showing AI output reduces overreliance at an effort cost — [arXiv 2503.06195](https://arxiv.org/pdf/2503.06195) (search summary)
- Vendor stance that checkpoints substitute for per-change approval: Cline ("Checkpoints make auto-approve practical") — [Cline](https://docs.cline.bot/core-workflows/checkpoints.md); VS Code's auto-accept delay plus the warning to review before commit — [VS Code](https://code.visualstudio.com/docs/copilot/chat/review-code-edits)
- Repo context: review burden is the most widely shared cost in the repo's practitioner corpus (~190 HN authors) — [agent UI synthesis](../agent-ui-research.md)

### Inferences
- Products are moving from confirm-before (P2) to apply-then-review (P1/P3) for local, reversible state, exactly as NN/g and HAX recommend, while keeping confirm-before for external writes (Notion email, VS Code's "use the external service's recovery controls").
- Auto-accept timers and "auto-approve + checkpoints" lower review effort, and the overreliance evidence suggests many users will then not review; the undo layer must stay usable after acceptance (VS Code checkpoints, Claude Code rewind) for this to be safe.
- For our harness: track review state and checkpoints separately in the event log; scope checkpoints to tool-tracked writes and say so; classify tools as reversible-local vs external, and require approval (or a deferred-commit undo window) for the latter.

### Gaps
- Google PAIR guidebook guidance on undo/correction: not fetched.
- No product-telemetry data found on how often users Keep vs Undo agent edits, or on use of checkpoints.
- No controlled study comparing undo-first vs confirm-first for AI agent actions was found.
