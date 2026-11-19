# Raw notes: mapping the arXiv triage to our current todos and ADRs

This is a reference note for U22's writer, not a draft of the report itself. It is drafted against the repo as it stands on 2026-11-19, on branch `todo/U22-agent-research-papers`. Treat the exact ids below as current; do not carry over ids from `docs/research/browser-use/browser-use.md`, which was written against an earlier state of the roadmap and whose own proposed ADR numbers (0045–0047) have since been taken by unrelated decisions.

## What exists for Step 2 right now

Only one of the six expected section files exists:

- `docs/research/papers/notes/arxiv-2026-11-18-snapshot.md` — exists, 74 lines, read in full.
- `section-tool-security-draft.md` — **missing**.
- `section-provenance-draft.md` — **missing**.
- `section-evals-draft.md` — **missing**.
- `section-selfimprovement-draft.md` — **missing**.
- `section-multiagent-draft.md` / `section-architectures-draft.md` — **missing**.

So every mapping below comes from the snapshot's own one- or two-sentence paraphrases and relevance tags, not from a closer reading of drafted sections (none exist yet). When the section drafts are written, each mapping here should be re-verified against the fuller paper summary, since a paraphrase can flatten a nuance that changes which todo it actually bears on.

## Is the roadmap even open to new todos right now?

**No, for most of what this survey would touch, and the browser-use report already set the precedent for proposals-only output.** The roadmap's Status line (`docs/plans/roadmap.md`) says: "The SDK, the harness and Round E are being built" (Round B / M5, Round N / M6, Round E / M5e). Rounds W (coding agent), F (agent platform) and A (triage agent) "stay on hold, and no todo in them starts until the owner says go." Round Q, L and T/U are also live or startable. This note's mappings land mostly in Round N (session log, permissions, sandbox, evals, ablation — all open) and Round F/W (gate, eval tasks, shadow metrics — on hold). So:

- Any proposal that lands on an **open** Round N todo (session log, tool registry, permission pipeline, sandbox, extensions/skills, credential proxy, ablation) could in principle become an acceptance-criteria addition to an existing ready/ongoing todo once the owner approves it — but U22 itself should still only produce **proposals**, the same as the browser-use report's "Eighteen proposed plan changes... await the owner's decision" section, not direct edits to those todos.
- Any proposal that lands on a Round F, W or A todo (the gate, eval tasks, shadow metrics, tool-contract-lint) is **on hold by owner decision** and must be flagged as such — a proposal for later, not something to act on now.
- No proposal here should open a **new** todo file; it should propose adding to an existing todo's scope/acceptance criteria, or propose a new ADR, exactly as the browser-use report did.

## Next free ADR number

**0058.** The highest file in `docs/decisions/` is `0057-book-keeps-third-party-listings-and-adds-ours-as-tabs.md`; `docs/decisions/README.md`'s index runs unbroken 0001–0057 with no gaps or reserved-but-unwritten numbers. (Note for the writer: the browser-use report proposed ADR numbers 0045–0047 for its own changes; those numbers have since been taken by unrelated accepted ADRs — HD8 eval tasks, Vitest, and first-release/trusted-publishing. This is itself evidence of how fast the ADR sequence moves and why ids must be re-checked at write time, not copied from an older report.)

## Paper-by-paper mapping

Numbers refer to the snapshot's numbered list (`arxiv-2026-11-18-snapshot.md`).

### Coding-agent cost and verification

1. **#12, Timeout Cascades (cost).** Small-model-first escalate-on-timeout cuts SWE-bench Verified GPU-hours up to 33%. Maps to the SDK's gateway/cost layer and the coding agent's eval story: no current todo covers a cascade-style model-tiering policy. `B5` (usage/cost catalog) and `B21`/`B22` (price-catalog docs) track cost *accounting*, not cost *strategy*; `W12` (coding-agent eval tasks) and `N38` (seed-suite baseline) are where a cascade's pass-rate/cost tradeoff would actually be measured. **Gap:** propose a note in `build-coding-agent.md` or a new SDK decision (not yet an ADR) that a per-call model-tier escalation policy is worth evaluating once W8's cloud-mode evals exist — this is a plan-change proposal, not an acceptance-criteria edit, since no todo currently scopes it.

2. **#26, Truthgate (false success claims).** Host-side tests plus a signed, uneditable tool-call log to catch coding agents that falsely claim success. This directly **confirms** the design already in `N13` (signed approvals, HMAC key ring, re-evaluated on resume) and the harness's completion-check todo `N32` (completion check) plus `HD10` (configured/discovered checks run in the sandbox after "done"). Concretely: `N32`'s acceptance criteria should consider adding a check that the agent's own "done" claim is independently verified against the signed log rather than trusted at face value — this is already close to what HD10 does, so the mapping is a confirmation with a possible tightening, not a gap.

3. **#35, Runtime Transaction Schema ("Atm").** Transaction records for agent retries, fallbacks, abandoned sessions. **Confirms** `N2`'s session-entry union (every state change as a typed entry) and `ADR 0013` (log entry per content block). No gap: our `SessionEntry` union plus `B11b` (turn-level retries, SDK) and `B14` (budget/progress) already cover retries and abandonment as first-class entries; this paper is useful corroborating evidence for `N2`'s design note, not a new requirement.

### Tool/skill security and authority

4. **#13, SkillCFI (control-flow integrity for skills).** Compiler + runtime enforcer confining a skill to a fixed control flow. Maps to `N22` (in-process extensions: composition, trust tiers, content-hash pins) and `N23` (skills/context files). **This is a gap, stated plainly:** `N22`/`N23` pin skill *content* by hash and gate *loading* by project trust ("trust is not a sandbox" is literally a stated doc task in N22), but neither todo enforces anything about a skill's *execution* control flow once loaded — they are a different mechanism (static hash pinning vs. runtime CFI enforcement). SkillCFI's actual technique (deriving a control-flow policy at compile time and enforcing it at runtime) does not map onto any current todo; it would be a new capability, not an extension of N22/N23's scope. Flag as a genuine gap rather than force it onto N22.

5. **#24, ACaM (capability modeling from code).** Static analysis derives a tool's real capabilities from its code, catching description/behavior mismatches; evaluated on 43 agents. Maps well to `A3` (tool-contract-lint — currently **deferred**, Round A) and `N12` (permission pipeline). `A3`'s lint already checks shape (name pattern, description length, no identity-shaped fields, tier present) but not behavior-vs-description mismatch via static analysis of the tool's implementation. Propose: when A3 resumes, its scope should consider adding a static-analysis pass (ACaM-style) that flags a tool whose declared capability (what the schema/description claims) diverges from what its code actually touches (filesystem, network, process). This is a plan-change proposal for a deferred todo, not an immediate edit.

6. **#33, Authority escalation in CI/CD (932,791 agent PRs).** Control-plane changes carry higher governance risk. **Confirms** `ADR 0036` (loop outside sandbox, PR is the approval point) and `ADR 0042` (generated code runs only in a fresh hosted sandbox, no credential inside). Also relevant to `W6` (PR delivery) and `F11`/`F15` (generated-code isolation, security review — both on hold): propose that `F15`'s threat model (already scoped to include MCP attack classes per plan review 2) explicitly add "agent-authored changes to CI/CD config or permissions" as a reviewed category, since this paper gives an empirical base rate for exactly that failure mode. On-hold todo, so this is a proposal for later, consistent with the roadmap note above.

### Platform governance and evaluation

7. **#15, Capability Framework / halo effect.** A bank's evaluation of ten agent platforms finds a halo effect in demo-based scoring; proposes gate-then-score. **Directly confirms** `ADR 0039` (check-and-deploy gate, graders the generator never sees) and the gate todos `F3`/`F4` (both on hold). Propose: `F4`'s hidden-grader design should cite this paper as independent evidence that demo-based self-scoring is unreliable and that held-out graders are the right countermeasure — a documentation strengthening of F4's "Context" section, not a scope change.

8. **#19, Governed ML-experimentation lifecycle/provenance.** Scores agents on process/provenance via a governed harness and append-only ledger. **Confirms** `N2`/`N3` (session log, append-only tree) as the right shape for provenance tracking, and is relevant background for `N33` (retention/schema docs). No gap — this is corroborating evidence for a design already built.

9. **#39, TriAgent (shadow-mode doc maintenance, 81.1% verifiable-assertion accuracy).** A deployed multi-agent system that proposes doc fixes and is graded in shadow mode before being trusted. **Confirms** the shadow-mode methodology in `A22` (shadow metrics, rollout stages — currently **deferred**, Round A) and the general shadow-wrapper idea (`AD14`/helpdesk shadow wrapper). Also relevant as an analogue for the coding agent's own "watch before trusting" posture, though no todo currently proposes shadow-mode for the coding agent itself (W-round) — worth flagging as a possible proposal for a later W todo, but speculative since no current todo scopes it.

10. **#40, Runtime Verification of NL Criteria (VFM) and #47, Verifying Agents in Rubric-Graded Environments ("Gandalf").** Both are about scoring many natural-language criteria cheaply and reliably. Maps to `A17` (eval task format, seven graders — deferred, Round A) and `N36`/`N37` (eval reports, Inspect bridge). `A17` already specifies a "rubric judge with Unknown" grader; these two papers are relevant prior art for *how* to build that judge cheaply and reliably (tree-attention parallel scoring, a dedicated small verifier). Propose: when A17 resumes, its rubric-judge grader design should consider citing these two papers' verifier architectures rather than a single large-model judge call. Deferred todo, proposal only.

### Multi-agent safety

11. **#9, Concealment from steering a single neuron.** Steering one neuron increases concealment decisions more in multi-agent teams than solo. This is tangential to our current plans: we have no multi-agent-team todo in flight (the triage agent, A-round, is single-agent-with-tools; the platform's generated agents are also single-agent per task as currently scoped). **This does not map cleanly onto anything in our current plans** — flag it as a paper to cite for general awareness (e.g., in a future multi-agent or self-improvement discussion) rather than force it onto an existing todo.

### Sandboxing/environments

12. **#32, EnvAgent / ENVBENCH.** Multi-agent system that builds and verifies Docker environments for repos. Maps to `N15`–`N19` (sandbox interface, backends, escalation, measurement) and `W1` (coding-agent scaffold). The actual contribution — *automating* environment construction — is not something any current todo asks for; our sandbox todos assume a known base image and workspace, not agent-driven environment synthesis. **Partial gap:** relevant as a benchmark/evaluation idea (ENVBENCH itself, as an additional eval suite) but the "multi-agent environment builder" half of the paper has no home in our plans and shouldn't be forced into N15–N19, which are about the sandbox *interface*, not automated environment generation.

### Cross-org trust

13. **#37, Agent Trust Infrastructure (ATI).** PKI-based cross-organization trust layer; simulated attack containment improved 43% → 84%. Loosely touches the platform's tenant-isolation ADRs (`0037`, `0040`–`0042`) and overlaps `U19` (A2A research) at the edges, per the snapshot's own note. Our current plans are single-tenant-cloud-account scoped (ADR 0040: each tenant's own cloud, own key) rather than cross-organization agent federation, and we explicitly have no A2A client/server in v1 (`build-harness.md §1`, per U19/owner decision 2026-11-19). **This does not map cleanly onto anything in our current plans** — the platform's trust model is tenant isolation within our platform, not cross-org agent-to-agent trust, so ATI's actual mechanism (PKI across organizations) is out of scope until A2A is revisited. State this plainly rather than stretching ADR 0037 to cover it.

### Self-improvement

14. **#25, GUARD (regret-guided harness self-improvement).** Grader-free framework for evolving agent harnesses (prompts, skills, memory) while blocking regressions/memory bloat. Maps to `N34` (ablation switches, ablation hash) and `N39` (ablation/tuning runs) — both open, Round N. Both existing todos are about *measuring* the effect of removing a component, not about *automatically evolving* the harness's own configuration over time. **Gap, stated plainly:** no current todo covers self-modifying/self-tuning harness configuration; N34/N39 are manual, human-read ablation studies, not an automated regret-guided search. Worth a plan-change proposal for a later round (not Round N, which is nearly fixed-scope) rather than retrofitting N34.

### Tangential ([~]) items worth a one-line note each, not a mapping

- **#14, MemoSync** (developer reviews/edits agent-proposed memory) overlaps `U18`/`N52` (file-based memory) but adds a human-review-of-memory angle that `N52`'s scope (as currently written per the roadmap's U18 summary) does not obviously include — worth flagging to the writer as a possible U18 follow-up, not a Round N scope change now that N52 is presumably near-final.
- **#22, Value Semantics Layer** (persistent planner-visible DB semantics) is adjacent to tool contracts (`A3`, `N11`) but is about a specific domain (databases) our tool-contract design doesn't single out — no clean mapping.
- **#38, Inference after coding agents** (54–98% false-positive "significant" findings on null data) is a caution about trusting agent-produced statistical claims; it doesn't map to a todo but is worth a general-caution citation if the report discusses agent-produced findings/evals credibility (e.g., near A17's grader discussion).
- **#44, VITAL** (pharma validation framework) "parallels our gate-report design" per the snapshot's own note — same relationship as #15/#19 above, no new mapping beyond what's already stated for the gate (F3/F4).

## Summary for the writer

- Concrete, usable mapping items (paper → specific todo/ADR with a stated action): **13** (items 1–13 of 14 numbered mappings above; item 14 doubles as both a mapping and a stated gap).
- Clear, plainly-stated non-matches (flag rather than force): **#9 (concealment), #37 (ATI/cross-org trust), and the EnvAgent "automated environment builder" half of #32**.
- Clear gaps (paper describes a real capability with no current todo covering it): **SkillCFI (#13) vs. N22/N23's hash-pinning**, **GUARD (#25) vs. N34/N39's manual ablation**, and the cost-cascade strategy (#12) vs. the cost-*accounting*-only scope of B5/B21/B22.
- Everything above is a **proposal for the owner**, in the style of the browser-use report's "proposed plan changes" table — nothing here should be read as an approved scope change, and nothing should be written directly into any todo file.
- Next free ADR: **0058**.
- Missing section drafts at time of writing: `section-tool-security-draft.md`, `section-provenance-draft.md`, `section-evals-draft.md`, `section-selfimprovement-draft.md`, `section-multiagent-draft.md`, `section-architectures-draft.md` — all six. Only the raw arXiv snapshot exists. Re-verify every mapping above once the section drafts land, since this note was built from one- or two-sentence paraphrases, not full paper summaries.
