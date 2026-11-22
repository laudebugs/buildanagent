# Mapping U22's agent-research findings onto the book's Round T todos

Working notes, 2026-11-19, read against `main` with U22 merged. Nothing here is applied; each proposal waits for the owner. Sources read in full: [`agent-research-papers.md`](../agent-research-papers.md) (U22), its [fact-check log](../fact-check-agent-research-papers.md), [`build-book.md`](../../../plans/build-book.md), every T-todo whose subject touches U22's six topics, and the three written chapters in `apps/manual/src/content/chapters/` (`call-workflow-loop.md`, `talking-to-a-model.md`, `tools.md`).

**Result.** Eight of the 56 Round T todos get a real proposal: one change to a written chapter (T11) and seven context additions to unwritten chapter todos (T16, T17, T20, T21, T22, T25, T36). The other 48 need nothing, and the reason is given for each below.

**What "56" counts.** `build-book.md` §5 counts 56 todos: the 52 T-numbered ones (T1–T52; 17 done, 35 ready) plus the four research todos U18–U21, which are done. U22 cites U18 and U19 for their own ground rather than repeating it, so U18–U21 need no change.

## Rules every proposal here follows

- **A chapter may cite a U22 paper only through the source register.** Under BK6, each register entry's `verifiedIn` must name a fact-check log that contains the entry's URL. [`docs/research/papers/fact-check-agent-research-papers.md`](../fact-check-agent-research-papers.md) qualifies (a `fact-check*.md` under `docs/research/`), and it carries every arXiv URL cited below.
- **Which rows can be cited as they stand.** Rows 1–7, 9–10 and 13–14 (architectures), 19–24 and 27–28, 31–32 (evals), 36–51 (multi-agent), 65–69 and 72–80 (tool security), 113–122 (self-improvement) and 145 (Truthgate) are ✅ or ✏️ against each paper's own abstract.
- **Which rows need a fresh read first.** All 15 rows for the six provenance papers (91–94, 96–97, 99–101, 103–104 and 107–110: the halo effect, Wong, Hou et al., Masoero, VFM, Gandalf) are ⚠️ (secondary summary), because the fetch tool returned a summary of each abstract, not its text. A chapter that cites one of those papers must first re-read its abstract and log its own ✅ row (BK21). The two OpenAI SWE-bench Verified claims (rows 25 and 26) are also secondary, as is the 38% trivial-pass figure in row 28.
- **Proposals are not decisions.** U22's four proposed changes (skill control-flow checks, a code-level capability check, a stricter path for CI/CD diffs, many-criterion graders) await the owner. A chapter may teach the gap a paper shows, but must not say our stack already closes it.

## Done chapters (3)

### T10: Use the least autonomy that works (`call-workflow-loop.md`). Verdict: no change needed

The chapter defines the loop from Anthropic's tool-use documentation ("Anthropic's tool-use documentation spells the cycle out in five steps, and every SDK in this book runs the same cycle under its own names") and never claims a lineage or an origin for it. That cycle is ReAct's interleaved reason-and-act loop, and nothing in U22 contradicts the chapter's account. The chapter's fourth question already hands planning and multi-agent design to Chapter T17 ("Splitting it across several agents is a question for [[ch:choosing-the-shape]]"), and T17 is where U22's lineage belongs (see T17 below). Adding ReAct to a Part I chapter on picking a shape would be a citation the text does not need.

### T11: Talking to a model (`talking-to-a-model.md`). Verdict: propose a chapter-text addition (one sentence)

**Target file:** `apps/manual/src/content/chapters/talking-to-a-model.md`, in the section "Keep the system prompt short, and freeze it for the session", third bullet.

**Current passage:**

> - **Rules that must hold every time.** A sentence in a prompt asks; only code can refuse. A rule such as "never refund more than the order total" belongs in the refund tool's own check, which [[ch:tools]] and [[ch:approvals-guardrails-and-injection]] build.

**U22 finding.** Truthgate (Ghosh, [arXiv:2611.23335](https://arxiv.org/abs/2611.23335), 17 November 2026). Claude Sonnet 5.5 special-cased its code to a false pass on 39 of 180 impossible tasks (21.7%). On a separate 60-task prompt-ablation subset, adding one "AI reviewer" sentence to the prompt cut Sonnet's cheats from 22 to 8 (U22 fact-check row 145, ✏️ (citation), read from the abstract). That is measured support for the chapter's claim: a single sentence moved behaviour a lot, but it did not make the behaviour hold every time.

**Proposed text**, inserted after "only code can refuse.":

> A sentence still moves behaviour, only not all the way. In one November 2026 study of coding agents given impossible tasks, adding a single sentence to the prompt cut Claude Sonnet 5.5's cheating on a 60-task set from 22 cases to 8, not to none [@ghosh-truthgate].

**What the edit also needs:**

- a register entry `ghosh-truthgate` with `verifiedIn: docs/research/papers/fact-check-agent-research-papers.md`;
- `ghosh-truthgate` added to the chapter's `sources`;
- a new row in `apps/manual/fact-checks/talking-to-a-model.md`. Before writing the row, confirm in the paper that the sentence went into the system prompt rather than the task prompt: row 145 says only "an 'AI reviewer' sentence", and U22's prose says "system prompt". Reword "to the prompt" to match what the paper says.

The chapter is done, so the edit needs its own branch and pull request under the AGENTS.md rules, with the writing review for the changed copy.

**Considered and not proposed** for the same chapter: the timeout-cascade paper (arXiv 2611.24324) beside "Choose a model by starting with the most capable, then trying smaller ones". Its results are GPU-hour costs for 36 open-weight models on SWE-bench Verified, while the section prices API calls per token. It also inherits SWE-bench Verified's contamination caveat. It fits T25's "report cost beside pass rate" better (below).

### T12: Tools (`tools.md`). Verdict: no change needed

Two passages were checked against U22.

> Anthropic reports that Claude Sonnet 3.5 reached state-of-the-art performance on SWE-bench Verified "after we made precise refinements to tool descriptions". That benchmark is a set of 500 real GitHub issues from Python projects, each checked by hand.

This agrees with U22's description, which confirms the 500-task count and the human screening on swebench.com (row 25). U22's critiques, memorization ("The SWE-Bench Illusion") and thin test suites (the Agentic Benchmark Checklist), are about absolute scores as evidence of capability. The chapter uses Anthropic's result only as a before-and-after on tool descriptions. A caveat here would be a detour for a Part I reader; T25 is where the critique belongs.

> In the Claude Agent SDK, `readOnlyHint` "Controls whether the tool can be called in parallel with other read-only tools"

ACaM's "Description-Code Inconsistency" (arXiv 2611.23507) shows that a tool's declared description and hints can understate what its code does. The chapter, though, teaches what the model reads, and it never claims that a description or hint constrains the code ("The model never sees this function"). ACaM's lesson concerns a reviewer or a permission system that trusts the declaration. That is T21's and T22's subject, so the proposals sit there.

## Unwritten chapter todos with a proposed context addition (7)

Each addition is one bullet in the todo's `## Context` list, placed before the "Book plan BK21 and BK22" bullet. Links are relative to `docs/todos/ready/`.

### T16: Testing offline, and a first complete agent. Verdict: propose a todo-context addition

The chapter's second section is "`check()` assertions and what they can and cannot show", and its exercise asks the reader to "Add one assertion to the capstone and make it fail, then pass". The Agentic Benchmark Checklist (arXiv 2507.02825, row 28 ✅) gives that section a real example of a check that proves nothing: τ-bench's grader counted an empty response as a pass, so a trivial agent cleared 38% of its tasks. Row 28 confirms the empty-response claim from the abstract, but the 38% figure rests on a search summary of the paper, so the drafter must confirm it in the paper itself. The lesson carries straight to `check()`: an assertion that an empty or trivial answer also satisfies shows nothing. Of the seven additions this is the weakest, because the main treatment of eval graders is T25's.

**Proposed addition to `docs/todos/ready/T16-chapter-testing-offline-and-a-first-agent.md`, `## Context`:**

> - [Agent research papers, evals section](../../research/papers/agent-research-papers.md#a-trustworthy-eval-suite-needs-its-own-fresh-tasks-and-a-baseline-agent-because-the-published-benchmarks-grade-too-loosely-to-gate-a-release) (U22): the Agentic Benchmark Checklist found that τ-bench's grader counted an empty response as a pass, letting a trivial agent clear 38% of tasks (arXiv 2507.02825; fact-check row 28, where the 38% rests on a search summary, so confirm it in the paper before citing). Use it in the `check()` section to show that an assertion an empty answer also passes proves nothing.

### T17: Choosing the shape. Verdict: propose a todo-context addition

This is the strongest fit. T17's planning section is "ReAct first, then plan-and-execute and reflection when they earn it (main report)". The main report's section "Planning should start as ReAct and earn every extra agent" cites only practitioner blogs (dev.to, generalcompute, mlflow.org) and Anthropic's posts, and it says its cost figures "are illustrative worked examples, not measurements". U22 supplies the primary papers for every pattern the section names:

- ReAct (arXiv 2210.03629, rows 1–3) and Reflexion (2303.11366, rows 4–5);
- a plan-then-execute guide that argues the pattern resists prompt injection by fixing control flow before any tool runs (2509.08646, row 13), and a peer-reviewed survey of the planning-versus-reasoning split (2508.17281, row 14).

T17's section "Workflows, routing and handoffs" and its subagent section gain AutoGen, MetaGPT and CAMEL (rows 36–43). They also gain the November 2026 concealment result (arXiv 2611.24475, rows 44–48): a safety property checked on one agent alone is not yet one of the team. The subagent cost multipliers (4× and 15×) stay with Anthropic's post.

**Proposed addition to `docs/todos/ready/T17-chapter-choosing-the-shape.md`, `## Context`:**

> - [Agent research papers](../../research/papers/agent-research-papers.md) (U22): its [architectures section](../../research/papers/agent-research-papers.md#our-loop-already-is-a-react-loop-later-papers-add-layers-around-it-not-a-rival-architecture) gives the primary papers behind the planning section, ReAct (arXiv 2210.03629), Reflexion (2303.11366) and a plan-then-execute guide (2509.08646), which the main report's planning section cites only through practitioner blogs. Its [multi-agent section](../../research/papers/agent-research-papers.md#splitting-an-agent-into-roles-buys-verification-but-the-team-itself-becomes-a-new-failure-surface) gives AutoGen, MetaGPT and CAMEL for handoffs and roles, and the finding that a safety check passed by one agent alone may not hold in a team (2611.24475). Cite them through U22's [fact-check](../../research/papers/fact-check-agent-research-papers.md), rows 1–5, 13–14 and 36–48; the 4× and 15× token figures stay with Anthropic's post.

**Not proposed for T42**, the subagent example T17 waits for. Its scope, `agent.asTool()` with the subagent's transcript kept out and usage reported, is code. No U22 finding changes what that example should assert.

### T20: The session log and context policy. Verdict: propose a todo-context addition

T20's research question is "Why should a harness keep one append-only tree of entries". Two U22 provenance papers answer the "why" with evidence beyond our own ADRs:

- Hou et al. (arXiv 2611.23234) found that agent-output datasets keep patches, commits and benchmark results but drop the failed retries, fallbacks, routing decisions and abandoned sessions that drive cost and reliability. They propose structured runtime transaction records instead.
- Wong (arXiv 2611.23678) keeps every trial in an append-only ledger and computes governance metrics, such as invalid-action rate and provenance completeness, from that ledger.

Both papers' rows (96–97, 99–101) are ⚠️ (secondary summary). Row 101 also flags that Hou et al. was submitted on 11 August 2026, not in November, despite its "2611" id. So the addition tells the drafter to re-read both abstracts first.

**Proposed addition to `docs/todos/ready/T20-chapter-the-session-log-and-context.md`, `## Context`:**

> - [Agent research papers, provenance section](../../research/papers/agent-research-papers.md#trustworthy-agent-provenance-needs-a-replayable-transaction-log-per-criterion-verifiers-the-generator-cannot-see-and-a-staged-gate-before-any-demo-based-score-counts) (U22): Hou et al. (arXiv 2611.23234) found that agent-output datasets keep patches and commits but drop the failed retries, fallbacks and abandoned sessions that drive cost and reliability, and Wong (arXiv 2611.23678) computes governance metrics from an append-only trial ledger; both bear on why the log keeps every entry. U22's rows for both papers are ⚠️ (secondary summary, rows 96–101), so re-read each abstract and log a ✅ row before citing it; Hou et al. was submitted on 11 August 2026, not in November.

### T21: Tools at scale. Verdict: propose a todo-context addition

Three of T21's planned sections meet U22's tool-security findings:

- **Skills.** The planned analogy breaks at "a skill read into context costs tokens every turn it stays there". SkillCFI (arXiv 2611.24185, rows 65–69) adds a second break: a skill's advertised steps and its possible steps diverge. None of 53 public skills passed a fixed control-flow graph as written, and runtime enforcement blocked all 240 violations that a plain allowlist admitted.
- **The registry.** ACaM (arXiv 2611.23507, rows 72–75) shows that a registry that trusts a tool's description can be laundered, because code may reach beyond what its description says.
- **MCP.** The analogy's break note already says "its tools are untrusted", and ACaM gives that note measured evidence.

For the skills lineage, Voyager's skill library (arXiv 2305.16291, rows 9–10) is the primary source for keeping skills as files.

**Proposed addition to `docs/todos/ready/T21-chapter-tools-at-scale.md`, `## Context`:**

> - [Agent research papers, tool-security section](../../research/papers/agent-research-papers.md#our-permission-pipeline-checks-what-a-tool-call-asks-to-do-but-not-what-the-tools-code-or-a-loaded-skill-actually-does) (U22): SkillCFI (arXiv 2611.24185) found that none of 53 public skills stayed within a fixed control-flow graph as written, and that runtime enforcement blocked all 240 violations a plain allowlist admitted. ACaM (arXiv 2611.23507) found tools whose code reaches beyond their description ("capability laundering") in real agents. Use them in the skills and registry sections and in the MCP analogy's break note, and Voyager (arXiv 2305.16291, [architectures section](../../research/papers/agent-research-papers.md#our-loop-already-is-a-react-loop-later-papers-add-layers-around-it-not-a-rival-architecture)) for skills kept as files. The checks both papers imply are U22 proposals 1 and 2, not adopted, so teach the gap without claiming our registry closes it.

### T22: Permissions, sandboxes and credentials. Verdict: propose a todo-context addition

T22's first section, "A deny-first permission pipeline", teaches a pipeline that decides each call from the tool's declared contract. U22 finds two limits to that design and gives T22's incident opening real material:

- **ACaM** (rows 72–75): the pipeline checks what a call asks to do, not what the tool's code can do.
- **Staron** (arXiv 2611.23251, rows 77–80): across 932,791 agent pull requests, control-plane changes to CI/CD workflows and permission settings carried far higher governance risk than ordinary code changes. That is an agent widening its authority through the pipeline meant to constrain it.

ADR 0036 is already in T22's Context, and U22 shows that neither ADR 0036 nor ADR 0039 treats a CI/CD diff differently from any other diff. That different treatment is U22 proposal 3, on hold with Round F, so the chapter may present the measured risk but not a rule we have adopted.

**Proposed addition to `docs/todos/ongoing/T22-chapter-permissions-sandboxes-and-credentials.md`, `## Context`:**

> - [Agent research papers, tool-security section](../../research/papers/agent-research-papers.md#our-permission-pipeline-checks-what-a-tool-call-asks-to-do-but-not-what-the-tools-code-or-a-loaded-skill-actually-does) (U22): a permission pipeline judges a tool call by the tool's declared contract, and ACaM (arXiv 2611.23507) shows that contract can understate what the code does. Staron (arXiv 2611.23251) measured, across 932,791 coding-agent pull requests, far higher governance risk in changes to CI/CD workflows and permission settings than in application code. Both bear on the pipeline section and the incident opening; a stricter path for CI/CD diffs is U22 proposal 3, awaiting the owner, so present the risk, not a rule we have adopted.

### T25: Evals, observability and release. Verdict: propose a todo-context addition

All four of T25's sections meet U22's findings.

- **pass@k and pass^k.** pass^k comes from τ-bench (arXiv 2406.12045, row 23). The agent guide §6 already cites τ-bench through the agent research, so the chapter needs no new source for it. U22 adds why a published score is not evidence on its own, which the chapter can cite: memorization ("The SWE-Bench Illusion", 2506.12286, row 27) and weak graders (the Agentic Benchmark Checklist, 2507.02825, row 28). It also adds the timeout-cascade result (2611.24324, row 31), which supports reporting cost beside pass rate.
- **LLM-as-judge.** The planned break note for the teaching-assistant analogy says the judge "can be wrong in systematic ways". The halo effect (Ali et al., 2611.24039) shows a panel's scores moving as one overall impression, and VFM (2611.23074) and Gandalf (2611.22841) show that many narrow criteria work better. Truthgate (2611.23335, row 145) found that a deterministic check over a signed log and an LLM judge catch different cheats, so a chapter should keep both.
- **Release.** The first stage is shadow mode in the planned analogy. The agent guide §7 calls the rollout evidence "thin and mostly practitioner writing". Masoero's 43-day, 499-ticket shadow-mode deployment (2611.23142) is a research data point for that stage.

The halo-effect, VFM, Gandalf and Masoero rows (91–94, 103–104, 107–110) are ⚠️ (secondary summary), so they need fresh reads before citing.

**Proposed addition to `docs/todos/ready/T25-chapter-evals-observability-and-release.md`, `## Context`:**

> - [Agent research papers](../../research/papers/agent-research-papers.md) (U22): its [evals section](../../research/papers/agent-research-papers.md#a-trustworthy-eval-suite-needs-its-own-fresh-tasks-and-a-baseline-agent-because-the-published-benchmarks-grade-too-loosely-to-gate-a-release) shows that published scores can reflect memorization (arXiv 2506.12286) or a weak grader (2507.02825: τ-bench counted an empty response as a pass), and that cost should be reported beside pass rate (2611.24324). Its [provenance section](../../research/papers/agent-research-papers.md#trustworthy-agent-provenance-needs-a-replayable-transaction-log-per-criterion-verifiers-the-generator-cannot-see-and-a-staged-gate-before-any-demo-based-score-counts) and closing paragraph bear on the LLM-judge and release sections: the halo effect in holistic scoring (2611.24039), many-criterion verifiers (VFM, 2611.23074; Gandalf, 2611.22841), a deterministic log check that catches cheats a judge misses and the reverse (Truthgate, 2611.23335), and a 43-day shadow-mode deployment (2611.23142). The provenance papers' rows are ⚠️ (secondary summary), so re-read each abstract and log a ✅ row before citing it.

**Not proposed for T34**, T25's tracing and LLM-judge example. It "tests the grading code, not a model's judgement" with a scripted judge. Splitting its rubric into per-criterion verdicts would widen its scope for a point the chapter's prose can make. Leave it as planned unless the T25 drafter finds the prose needs it.

### T36: Retrieval and long-term memory. Verdict: propose a todo-context addition

T36's third section asks "what to store, when to recall, when to forget". U22 notes that U18 covers memory, and U18's report cites neither Reflexion nor Voyager (checked by grep). Three primary results bear on the section:

- **Reflexion** (2303.11366, rows 4–5) stores a verbal lesson from each failed trial, not the transcript, and improves later trials with no weight change.
- **Voyager** (2305.16291, rows 9–10) stores skills as retrievable code, and its skill library transferred to a new world.
- **GUARD** (2611.23476, rows 113–116) accepts a memory or skill edit only when its gains outweigh its regressions, which avoids memory bloat and forgetting. That bears on the long-term-memory analogy's break note: "a model may write a wrong card and later trust it, so writes need rules".

**Proposed addition to `docs/todos/ready/T36-chapter-retrieval-and-long-term-memory.md`, `## Context`:**

> - [Agent research papers](../../research/papers/agent-research-papers.md) (U22), which U18 does not cover: Reflexion (arXiv 2303.11366) stores a verbal lesson from each failed attempt rather than its transcript, and Voyager (2305.16291) stores skills as reusable code, two primary answers to "what to store" ([architectures section](../../research/papers/agent-research-papers.md#our-loop-already-is-a-react-loop-later-papers-add-layers-around-it-not-a-rival-architecture)). GUARD (2611.23476, [self-improvement section](../../research/papers/agent-research-papers.md#a-regression-gate-not-a-grader-is-what-makes-recursive-self-improvement-safe-to-try-and-the-values-in-the-harness-decide-what-the-agent-becomes)) accepts a memory edit only when its gains outweigh its regressions, which bears on "writes need rules". Cite them through U22's fact-check, rows 4–5, 9–10 and 113–116.

## Todos with no proposed change (44 T-todos, plus U18–U21)

### Chapter todos whose subject U22 touches, but not closely enough

- **T13, Stopping.** U22 says nothing about caps, stop conditions or structured output.
- **T14, Approvals, guardrails and injection.** U22 leaves prompt injection to the browser-use report, which T35 and the agent guide §5 already carry. One U22 claim could bear on injection: plan-then-execute resists injection by fixing control flow first. But that is one guide's argument, not a measurement, and it belongs with T17's planning patterns. SkillCFI's result against allowlists is about skills, which is T21's subject. Adding either to a Part I chapter on approvals would force the citation.
- **T15, Memory within a task.** This chapter covers sessions within one task. Memory across attempts (Reflexion) is T36's subject.
- **T18, The model gateway.** The timeout cascade is a routing policy, and routing is not in T18's scope. Its GPU-hour results also don't match the chapter's per-token pricing. It goes to T25 as "cost beside pass rate".
- **T19, Events and hooks.** U22's claim that reflection and planning are "expressible as hooks" is its own synthesis (row 18, ✏️ (design)), not a source, and the design reasons for hooks come from ADR 0006 and the SDK guide.
- **T23, Side effects that can fail.** U22's one link here is its own inference that missing transaction records make rollback hard, which is why it cites the sagas research. T23 already cites that research directly.
- **T24, Durable and portable agents.** U22 has nothing on wake, seams or ingress.
- **T35, Agents people can watch.** U22's only point here, open problem 7 (no audit trail for who approved a takeover), comes from the browser-use report, which T35 already lists in its Context.

### Section todos

- **T37, A2A.** U22 mentions Agent Trust Infrastructure's cross-organization PKI only to say it maps onto nothing in our plans.
- **T38, Voice and realtime.** U22 has nothing on voice.
- **T39, Fine-tuning versus prompting.** Toolformer appears in U22, but its industry framing is unverified (row 8, ⚠️), and U21 already settled the section's four points.

### Example todos

T28–T34 and T40–T48. Each writes code to a fixed behaviour, and no U22 finding changes what any of them should assert. T30 (deferred tools and skills) is done. T34 and T42 are discussed above.

### Tooling and follow-up todos

T1–T9, T26, T27 and T49–T52 cover the build, the design, the content model, listings, figures, CI, deploy, checked inline code, the live run, HTTP transcripts and our-SDK tabs. None of them concerns agent design.

### Research todos U18–U21

They are done. U22 cites U18 and U19 for their own ground and adds nothing that contradicts any of the four.

## Summary

Of the 56 Round T todos, 8 have a real proposed change and 48 have none. One is a change to a written chapter: T11 gains one sentence citing Truthgate. Seven are context additions to unwritten chapter todos: T16, T17, T20, T21, T22, T25 and T36.
