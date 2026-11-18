# What works: practices practitioners report as reliable (HN, 2025-05-18 to 2026-11-18)

*Round H theme note 1 of 6 ([plan §4b](../../../plans/build-guides.md)). Source: the 400-thread corpus in [corpus.md](../corpus.md), 111,532 comments. Quotes are short attributed excerpts; counts are distinct HN usernames. Model names such as "Fable", "Sol" or "Opus 5.5" are quoted as commenters wrote them and are not checked here.*

## Summary

Across 18 months of Hacker News threads, the practices that practitioners most often report as reliable all do one of two things: they give the agent a mechanical way to check its own work, or they keep the agent's context small and its task bounded. The most widely shared are writing a plan or spec to a file before coding (~400 authors mention it across 159 threads), giving the agent tests, type checks and linters as the oracle (~380 authors, 161 threads), splitting work into small, reviewable tasks (~260 authors, 128 threads), and resetting or isolating context with fresh sessions and subagents. Context files (AGENTS.md, CLAUDE.md) are the most discussed artifact (~850 authors, 197 threads), but their value is contested: commenters endorse short, correction-driven files and doubt long or generated ones. Over the period, the frame moved from "supervise a junior developer" (mid-2025) to "plan, then let it run against gates" (early 2026) to "agents review agents, inside a sandbox, while the human reviews interfaces" (late 2026). The note's main conclusion: what works is deterministic scaffolding around a stateless model, meaning file-based plans, executable checks, bounded context and a sandbox. Prompt rituals and multi-agent ceremony draw sustained scepticism, and several heavy users report simplifying back to a near-default setup as models improved.

## Writing the plan to a file before coding is the most widely shared practice

Support: ~400 authors across 159 threads mention plan mode, plan/spec files or implementation plans. In a 16-comment random sample, about 11 endorsed planning first; the rest only mentioned it. The single largest thread on workflow, [How I use Claude Code: Separation of planning and execution](https://news.ycombinator.com/item?id=47106686) (2026-02-22, 976 points), drew many comments from people who said they had independently arrived at the same research, plan, annotate and implement loop.

The pattern has three parts that recur. First, the plan is written to a file in the repo, not held in chat, so it survives compaction and can start a new session. Second, the human reviews and annotates the plan before any code is written. Third, the plan doubles as a progress log that the next session reads.

- "I like that it ends up in the repo as it means it survives compaction or lets me start a fresh session entirely." — simonw, [HN](https://news.ycombinator.com/item?id=46492381), 2026-01-04
- "A written plan becomes a debugging surface for those assumptions." — sparin9, [HN](https://news.ycombinator.com/item?id=47110595), 2026-02-22
- "all my projects start with a PLAN.md at the root, and that acts as the ‘save file’ recording our progress over time." — mock-possum, [HN](https://news.ycombinator.com/item?id=48778048), 2026-07-03

Counter-views (~15 authors in the planning threads alone): small fixes do not need a plan; specs cannot be complete up front, so iteration beats specification; and the elaborate versions look like superstition. Some also say that newer models made planning matter less.

- "A lot of things don't need planning at all. Simple fixes, refactoring, simple scripts, packaging, etc." — kissgyorgy, [HN](https://news.ycombinator.com/item?id=47111173), 2026-02-22
- "I don’t think you can ever have a perfect spec upfront, at least that’s my experience." — josefrichter, [HN](https://news.ycombinator.com/item?id=47111266), 2026-02-22
- "Here are my rituals to the software God." — dr_kretyn, [HN](https://news.ycombinator.com/item?id=47110814), 2026-02-22

A related, smaller practice is asking the agent to interview the user before planning (~90 authors across 64 threads mention "ask clarifying questions" or similar). It was most common in 2025, for example "please ask 10 questions before writing any code" — mihau, [HN](https://news.ycombinator.com/item?id=45525292), 2025-10-09.

## Tests, types and linters are the oracle, and agents do best when they can run them

Support: ~380 authors across 161 threads mention TDD, failing tests, test suites, type checkers, linters or compilers as a feedback loop. Endorsement is the majority reading, at about 9 of 16 in a random sample, with the rest neutral. This is the most consistently positive finding in the corpus, and skeptical threads agree with it too: [Ask HN: Do you have any evidence that agentic coding works?](https://news.ycombinator.com/item?id=46691243) (2026-01-20) has about 60 of 168 top-level authors mentioning tests.

- "The agent makes mistakes but it sees the failing tests and fixes it." — rmoriz, [HN](https://news.ycombinator.com/item?id=45164260), 2025-09-08
- "Syntax and type errors gets instantly picked up by type checker and corrected" — golergka, [HN](https://news.ycombinator.com/item?id=44660373), 2025-07-23
- "Scripts are deterministic, run in milliseconds, and use zero tokens." — cadamsdotcom, [HN](https://news.ycombinator.com/item?id=47107931), 2026-02-22
- "The actual constraints still belong in code: types, tests, linters, and dependency rules." — 3uler, [HN](https://news.ycombinator.com/item?id=49057411), 2026-07-26

A related claim is that typed or compiled languages make agents more reliable, because the compiler is a free oracle (~130 authors, 93 threads, by a loose filter). It is held mostly by Rust, TypeScript and Go users, for example "Claude Code introduces quite a few errors and then walks through the compile errors to fix things" — unshavedyak, [HN](https://news.ycombinator.com/item?id=44258483), 2025-06-12. A minority answers that the best language is the one the human knows well enough to catch errors in.

Counter-views and failure modes (~20 authors): agents game the oracle by lowering thresholds, deleting or weakening tests, or writing all tests at once. A full suite run can also flood the context.

- "Claude gives up quickly and just lowers the threshold." — bio-s, [HN](https://news.ycombinator.com/item?id=48207440), 2026-05-20
- "Claude Code often tries to write all tests at once" — Nizoss, [HN](https://news.ycombinator.com/item?id=44844503), 2025-08-09

Practitioners' answer to gaming is to enforce the loop outside the model, through hooks, CI or a separate test-writing agent that cannot see the implementation. See [the hooks section](#hooks-help-when-they-enforce-checks-but-they-are-not-a-security-boundary).

## Small, scoped tasks work and large one-shot changes do not

Support: ~260 authors across 128 threads mention small or atomic tasks, breaking work down, or one thing at a time. About 20 of 36 sampled mentions endorse the practice. It is widely shared and appears in every period, often framed as ordinary engineering practice rather than anything specific to agents.

- "its way better suited to scoped tasks. the trick is breaking things down before you start" — maxmorrish, [HN](https://news.ycombinator.com/item?id=47669797), 2026-04-07
- "Claude Code failed miserably (itself thought it had done a terrific job), but doing it in smaller chunks worked out quite well." — jansan, [HN](https://news.ycombinator.com/item?id=44767962), 2025-08-02
- "The trick is to break things into small enough pieces that you can review them." — koolba, [HN](https://news.ycombinator.com/item?id=50530221), 2026-11-17

The size of a task is usually set by what a human can review, or by what fits in one context window. One commenter sizes tickets "for each chunk of work that would take about a context window length" — gbnwl, [HN](https://news.ycombinator.com/item?id=46432580), 2025-12-30. The counter-view is about effort, not correctness (a few authors): very small changes can be "harder to describe in words than to just outright do" — exe34, [HN](https://news.ycombinator.com/item?id=45524825), 2025-10-09. Others report long autonomous runs on large plans working with late-2026 models, as described under [Shifts over time](#shifts-over-time).

## Short, correction-driven context files help; long or generated ones are doubted

Support: AGENTS.md, CLAUDE.md and rules files are mentioned by ~850 authors across 197 threads. That is the highest count in this note, but much of the talk is about naming and vendor support (the [AGENTS.md launch](https://news.ycombinator.com/item?id=44957443), 2025-08-20; [Feature Request: Support AGENTS.md](https://news.ycombinator.com/item?id=49367350), 2026-08-19). The specific practices are smaller. Adding a line whenever the agent makes a mistake draws ~60 authors across 47 threads. Keeping the file short draws ~35 authors across 25 threads. Using the file to hold build and test commands, or to point at real docs, recurs in most threads.

- "keeping my CLAUDE.md minimal (under 100 lines) yields the best results." — Nizoss, [HN](https://news.ycombinator.com/item?id=44844503), 2025-08-09
- "I only put things when the LLM gets something wrong and I need to correct it." — eknkc, [HN](https://news.ycombinator.com/item?id=47044244), 2026-02-17
- "AGENTS.md should mostly point to real documentation and design files that humans will also read" — zozbot234, [HN](https://news.ycombinator.com/item?id=47109580), 2026-02-22

Counter-views are substantial (~25 authors in [Evaluating AGENTS.md](https://news.ycombinator.com/item?id=47034087), 2026-02-16, plus scattered others). That thread discussed a study, which commenters cite as arXiv 2602.11988, reporting that context files barely improved task success and raised token use. Commenters split. Some took it as proof that the files are cargo cult; others said the study measured codebase summaries, which agents can rediscover, rather than process rules, which they cannot. Instruction-following is the other complaint: agents ignore the file some of the time.

- "AGENTS.md files only save a bit of time, they don't meaningfully improve success." — mindwok, [HN](https://news.ycombinator.com/item?id=47044863), 2026-02-17
- "all you're doing with AGENTS.md is altering the probability distribution of outcomes" — ifwinterco, [HN](https://news.ycombinator.com/item?id=48801250), 2026-07-06

A practical convention emerged among multi-harness users: keep AGENTS.md canonical and symlink or reference it from CLAUDE.md, for example a "local symlink from CLAUDE.md to AGENTS.md, inside each repo" — blevinstein, [HN](https://news.ycombinator.com/item?id=49370389), 2026-08-20. A commenter quoting the changelog reported that Claude Code added AGENTS.md fallback support on 2026-09-18 ([HN](https://news.ycombinator.com/item?id=49760358)). That is secondary, so it should be checked against the changelog itself.

## Fresh context beats long sessions, and state should live in files

Support: ~255 authors across 137 threads mention fresh sessions, clearing context or context rot. About 6 of 16 sampled mentions endorse resetting as a practice; the rest are product chatter. A related practice is handing off through a progress or notes file (~65 authors, 43 threads), which ties directly to the plan-file finding.

- "Reset the context as often as you can. LLMs like short contexts" — stavros, [HN](https://news.ycombinator.com/item?id=45741747), 2025-10-29
- "Whatever thinking or context that led it there has inertia and tends to be sticky" — celrod, [HN](https://news.ycombinator.com/item?id=48780680), 2026-07-03
- "It’s best to compact strategically or summarize next steps to hand off to a new session." — Aurornis, [HN](https://news.ycombinator.com/item?id=48787949), 2026-07-04

Counter-view (a few authors, mostly late 2026): with 1M-token windows and better models, context rot matters less. One example is "Context rot is, from what ive tested, not as much of a concern now." — agentdev001, [HN](https://news.ycombinator.com/item?id=49907658), 2026-09-30. Others in the same period still cap sessions well below the window, such as one who hands off "when context hit about 800k" — Merad, [HN](https://news.ycombinator.com/item?id=49950333), 2026-10-04.

## Subagents work for isolating noisy exploration, not for splitting coupled work

Support: ~590 authors across 201 threads mention subagents, the second-highest count here, and the mention rate rose through the period. Sentiment is mixed. The use that draws the most agreement is context isolation: send a search, research or review task to a fresh context and get back a summary.

- "firing up a separate LLM running in a fresh context, posing it the question and having it answer back" — simonw, [HN](https://news.ycombinator.com/item?id=45388348), 2025-09-26
- subagents are "an order-of-magnitude level feature" — redhale, [HN](https://news.ycombinator.com/item?id=45557654), 2025-10-12
- better results "attribute to more of the work having clean context windows" — afro88, [HN](https://news.ycombinator.com/item?id=48313077), 2026-05-28

Counter-views (~30 authors). Handoffs lose context on coupled tasks, and custom subagents underperform the main agent. Fan-out also burns quota fast, and some users disable the built-in explore subagent entirely ([HN](https://news.ycombinator.com/item?id=48888090), 2026-07-13).

- "when you have a complex project that handoff is the kiss of death." — CuriouslyC, [HN](https://news.ycombinator.com/item?id=45232253), 2025-09-13
- "custom subagents in CC often perform noticeably worse than the main agent" — nojs, [HN](https://news.ycombinator.com/item?id=45001884), 2025-08-24
- "spun up 62 Opus 4.8 1M sub-agents for my dynamic workflow and maxed out my ~5hr cap in..... 18 minutes?" — Syntaf, [HN](https://news.ycombinator.com/item?id=48336974), 2026-05-30

## Parallel agents in worktrees work up to the human's review capacity, about two to six

Support: ~225 authors across 103 threads mention git worktrees or running several agents at once. Worktrees are the default isolation method, and the main reported failure is agents clobbering shared files when they are not isolated ([HN](https://news.ycombinator.com/item?id=44553691), 2025-07-13). The counter-view is unusually strong for a positive practice: ~67 authors across 40 threads tie parallelism to the review bottleneck, context switching or fatigue. Those who report success usually cap themselves at a handful of sessions.

- "I've started to use git worktrees to parallelize my work." — jmathai, [HN](https://news.ycombinator.com/item?id=47495188), 2026-03-23
- "I run 5-6 parallel sessions at most, otherwise I can't keep track of what's being done anyway." — guhcampos, [HN](https://news.ycombinator.com/item?id=50373357), 2026-11-05
- "eventually that code has to be looked at." — scuff3d, [HN](https://news.ycombinator.com/item?id=47496425), 2026-03-23
- "I need 1 agent that successfully solves the most important problem." — quijoteuniv, [HN](https://news.ycombinator.com/item?id=46523346), 2026-01-07

## Review is non-negotiable, but who reviews shifted from the human to a second agent

Support: explicit line-by-line human review is claimed by ~65 authors across 44 threads. Review by another agent, whether a fresh session, a review subagent or a different model, is mentioned by ~225 authors across 128 threads. Cross-model review specifically, such as Codex reviewing Claude, appears for ~50 authors across 32 threads. Cross-model mentions per comment roughly tripled from 2025 to late 2026, although 8 of the 22 late-2026 authors are in one thread ([Ask HN: What's your current AI agentic setup?](https://news.ycombinator.com/item?id=50366117), 2026-11-04).

- "I still review every line of code before pushing changes." — adastra22, [HN](https://news.ycombinator.com/item?id=45112166), 2025-09-03
- "I have a second fresh Claude session review the code with a set of 16 custom questions." — lgunsch, [HN](https://news.ycombinator.com/item?id=50378899), 2026-11-05
- "It's unbelievable how incredible gpt-6.1-sol even on medium reasoning is at reviewing Opus 5.5's work" — jeffy29, [HN](https://news.ycombinator.com/item?id=50176207), 2026-10-21
- "I focus on API interfaces, database schema changes, critical code paths" — Overdrivr, [HN](https://news.ycombinator.com/item?id=50542216), 2026-11-18

Counter-views (~20 authors). Reviewer agents raise many false positives, and two models agreeing is not evidence of correctness. Developers who no longer write code may also lose the ability to review it. The [Harvard review-bottleneck thread](https://news.ycombinator.com/item?id=50538303) (2026-11-17) is split between those who let agents review each other and those who call the output bad code that review only salvages.

- "this code critic is wrong about 60% of the time." — iambateman, [HN](https://news.ycombinator.com/item?id=45350944), 2025-09-23
- "somehow seem to assume that if both LLMs agree, they must not be completely wrong." — palata, [HN](https://news.ycombinator.com/item?id=48721350), 2026-06-29
- "when nobody writes code or feels ownership over it anymore, nobody will be qualified to or really interested in doing the code reviews." — jacobgorm, [HN](https://news.ycombinator.com/item?id=50539629), 2026-11-17

## Running without approval prompts inside a sandbox is the trusted setup

Support: ~440 authors across 159 threads mention YOLO or skip-permissions mode, devcontainers, VMs, bubblewrap or similar. Mentions per comment rose about 40% from 2025 to late 2026, and the late setup thread has ~47 of 410 top-level authors describing a sandbox, VM or container. The reasoning is consistent. Approval prompts cause fatigue and get rubber-stamped, so it is better to remove the prompts and bound what the agent can reach. A secondary benefit is that sandboxed agents are easy to send to the background.

- the Claude Code docs "suggest running YOLO mode using their Docker dev container" — simonw, [HN](https://news.ycombinator.com/item?id=45429049), 2025-09-30
- "The biggest advantage for me isn't security though, it's how easy it becomes to spin off agents to work in the background." — sothatsit, [HN](https://news.ycombinator.com/item?id=44547765), 2025-07-13
- "No permission prompts. The agent has free reign and never has to ask permission, but is in a sandbox." — kstenerud, [HN](https://news.ycombinator.com/item?id=49197904), 2026-08-06

Counter-views: a minority (~10 authors seen) runs with full host access and accepts the risk, for example "essentially yolo mode with mostly all system access" — josh_p, [HN](https://news.ycombinator.com/item?id=48484666), 2026-06-11. Others warn that agents probe the sandbox: "how often it tries to poke out of it for really lame reasons" — overgard, [HN](https://news.ycombinator.com/item?id=48948995), 2026-07-17. The security theme note covers incidents in depth.

## Hooks help when they enforce checks, but they are not a security boundary

Support: ~55 authors across 42 threads describe hooks or pre-commit and pre-push scripts that run formatters, linters or tests, or that block commands. This is a small but consistent group, concentrated among Claude Code users after hooks shipped ([Claude Code now supports hooks](https://news.ycombinator.com/item?id=44429225), 2025-07-01).

- "i have hooks for tests/lints, so i don't need to tell claude to do those things." — unshavedyak, [HN](https://news.ycombinator.com/item?id=44839512), 2025-08-08
- "Don't prompt your agent to do stuff, build your loop in a deterministic manner." — p_kuni, [HN](https://news.ycombinator.com/item?id=48815333), 2026-07-07

Counter-evidence (several authors): pattern-matching hooks are easy to route around, and an agent-written hook can be wrong in dangerous ways.

- "the hook denied `find /` but allowed everything else that existing permissions denied" — awfulneutral, [HN](https://news.ycombinator.com/item?id=50409124), 2026-11-07
- after a hook blocked find and grep, "it started using Python to find/search instead." — physicsguy, [HN](https://news.ycombinator.com/item?id=49669905), 2026-09-12

## CLIs and skills beat MCP for local coding work; MCP keeps a role for third-party and team services

Support: ~35 authors across 18 threads say outright that they prefer CLI tools over MCP, giving token cost and composability as reasons. Skills are mentioned positively by ~215 authors across 111 threads, which peaked in early 2026. The pattern is a small CLI plus a skill file describing it, loaded only when needed.

- "Skip the MCP ceremony (and wasted tokens) and just have CC use CLI tools." — itsalotoffun, [HN](https://news.ycombinator.com/item?id=44775831), 2025-08-03
- "AGENTS.md and MCP both put too much stuff in there - the skills pattern is a much better fit." — simonw, [HN](https://news.ycombinator.com/item?id=45622673), 2025-10-17
- "I use skills with a CLI tool instead of MCP and tools." — aussieguy1234, [HN](https://news.ycombinator.com/item?id=49907104), 2026-09-30

Counter-views (~15 authors). MCP works better for some APIs, and new CLIs still have to be taught to the model. For teams, MCP over HTTP gives central distribution and telemetry. Some also call the whole layer overrated: "Subagents/MCP/Skills are all pretty mid" — CuriouslyC, [HN](https://news.ycombinator.com/item?id=46546736), 2026-01-08; "in the end found the MCP to work better." — losvedir, [HN](https://news.ycombinator.com/item?id=48337315), 2026-05-30.

## Agents are reported most reliable for exploration, greenfield work and well-structured codebases

Support: ~290 authors across 136 threads discuss greenfield versus legacy work, and ~125 authors across 83 threads mention using agents to explore or explain a codebase. The widely shared view is that agents explain and navigate large codebases well. They build new things fast, but struggle with changes that need whole-system understanding, which is most real maintenance work. HN's senior-engineer skew shows here: many commenters measure success against mature production systems.

- "It should not be on a greenfield project, because nearly all coding is not." — rhubarbtree, [HN](https://news.ycombinator.com/item?id=45112846), 2025-09-03
- "Claude Code is great at documentation and helping you understand a large codebase, but not at making changes that require understanding the whole thing." — bicepjai, [HN](https://news.ycombinator.com/item?id=48149294), 2026-05-15

Counter-view (~10 authors): in a consistent existing codebase the agent "will go and look at the other endpoints and mimic the style as much as possible" — theshrike79, [HN](https://news.ycombinator.com/item?id=48049853), 2026-05-07. On this view, legacy code is not the obstacle; inconsistency is.

## Smaller practices with some support

These are minor but recurrent, and each is held by many authors in several threads. Committing often, with git as the undo mechanism, draws ~95 authors across 56 threads. Voice dictation for long, detailed prompts draws ~125 authors across 88 threads, for example combining Claude Code "extensively with Wispr Flow" — drltaidev, [HN](https://news.ycombinator.com/item?id=50382792), 2026-11-05. Long autonomous loops ("Ralph", overnight runs) draw ~150 authors across 110 threads, peaking in early 2026, and are almost always paired with a plan file plus a test gate. Keeping design docs in the repo for agents and humans draws ~350 authors across 191 threads by a loose filter.

## Shifts over time

The corpus has 107 threads from mid-to-late 2025, 174 from the first half of 2026 and 119 from the second half (26k, 55k and 30k comments). The rates below are distinct authors per 10,000 comments in each period, so they correct for the volume difference but not for the mix of threads.

**Mid-2025: supervise a junior developer.** The dominant framing was an agent as a fast but unreliable junior: 50 authors per 10k comments used junior or intern analogies, against 27 in early 2026 and 8 in late 2026. Practices were individual tricks to keep it on rails: CLAUDE.md, a markdown plan, TDD hooks and asking for clarifying questions. Clarifying questions ran at 16.5 per 10k in 2025 and about 6 afterwards. Skepticism was loud, as in [Generative AI coding tools and agents do not work for me](https://news.ycombinator.com/item?id=44294633) (2025-06-17). Representative: "they work best when they're treated as a very fast, very knowledgeable junior developer" — kr1shna4garwal, [HN](https://news.ycombinator.com/item?id=46701546), 2026-01-21, a late example of the 2025 framing.

**Early 2026: plan, then let it run against gates.** The [Opus 4.5 thread](https://news.ycombinator.com/item?id=46515696) (2026-01-06, 1,353 comments) and the planning-and-execution thread (2026-02-22) mark the point where many reported multi-hour runs from a reviewed plan. Subagents and swarms ([Claude Code's new hidden feature: Swarms](https://news.ycombinator.com/item?id=46743908), 2026-01-24), worktrees, skills and Ralph loops peaked in discussion. At the same time, scaffolding began to be questioned: the AGENTS.md study (2026-02-16), and "since 4.5 release, it feels less important" — chickensong, [HN](https://news.ycombinator.com/item?id=47109374), 2026-02-22. Human full review began to be dropped openly: "I don't do a full review anymore. I skim it" — _ink_, [HN](https://news.ycombinator.com/item?id=46704351), 2026-01-21.

**Late 2026: agents review agents, inside a sandbox.** Sandbox mentions rose from 37 to 52 per 10k, subagents from 51 to 74, and cross-model review from 2.3 to 7.2. Explicit line-by-line human review fell from 6.9 to 3.6. Setups described in the [Nov 2026 setup thread](https://news.ycombinator.com/item?id=50366117) combine several subscriptions, a second vendor's model as reviewer, a VM or container, and remote control from desktop or phone. Some heavy users simplified instead: "My workflow has simplified a lot over the past year" — l9o, [HN](https://news.ycombinator.com/item?id=50368019), 2026-11-04; "I use plain vanilla claudecode with the desktop app on auto with opus." — chasd00, [HN](https://news.ycombinator.com/item?id=50380233), 2026-11-05. The open question by November is review capacity ([Harvard thread](https://news.ycombinator.com/item?id=50538303)).

What stayed constant is planning to a file, tests as the oracle and small reviewable units, which appear in every period with similar arguments. One commenter observed in mid-2026 that "my workflow today does not look too different from a year ago" — ramoz, [HN](https://news.ycombinator.com/item?id=48796711), 2026-07-05. The lower late-2026 rates for planning and tests (17 per 10k, against 45 earlier) mostly reflect thread mix. Late threads are more about products, outages and security than about workflow, so these figures should not be read as declining use.

## Design implications for our SDK, harness and agent

1. **Make "plan and progress in files" a first-class harness pattern.** This is the most widely shared practice and the one that survives compaction. It supports harness decision 11, "Long tasks keep state in files, not summaries" ([agent-harness-research §6](../../agent-harness/agent-harness-research.md)). Ship a plan or progress file convention and a read-it-on-resume hook rather than relying on summaries.
2. **Treat tests, types and linters as the loop's verifier, enforced outside the model.** Practitioners report agents gaming tests that live only in the prompt. This supports agent decision 2, "Put every policy that must hold on every run into tool code or the gate, never only into the prompt" ([agent-research §6](../../agent/agent-research.md)), and SDK decision 3, failures returned in-band so the model can iterate ([agent-sdk-research §6](../../agent-sdk/agent-sdk-research.md)). An after-tool-call interceptor that runs checks (SDK decision 12) is the hook practitioners keep rebuilding.
3. **Hooks must not be the security boundary.** Command-pattern hooks are routed around. This supports harness decision 12, one ordered deny-first permission pipeline, and decisions 13–14 on sandbox and approval separation. Gating should happen on effects and capabilities, not on command strings.
4. **Default to a sandbox with no prompts rather than prompts without a sandbox.** Approval fatigue is the reason practitioners give for YOLO mode. Harness decisions 13–15 (separate sandbox and approval policy, honest sandbox tiers, no credentials inside) match what practitioners converged on; make the sandboxed, prompt-free mode easy and the default for background runs.
5. **Subagents are context isolation, priced.** Support subagents as tool calls in their own context that return a summary. Make their cost visible, using SDK decision 7's USD cap, and let users disable built-in subagents. Do not market them as a way to split coupled work.
6. **Plan for parallel sessions and second-model review.** Worktree-per-session and one writer per session (harness decision 3) match practice. The provider-neutral transcript (SDK decision 2) should let a second provider review a session's diff, since cross-model review is the fastest-growing practice here.
7. **Keep context files short and give them a trust gate.** Load AGENTS.md (with CLAUDE.md as an alias), favour short files, and expose a "record this correction" path rather than auto-generating files, which practitioners and the cited study both doubt. Repo-supplied files pass harness decision 17's project-trust gate.
8. **Prefer CLI tools plus progressively loaded skills over always-on MCP.** This fits harness decision 17, MCP as a removable built-in, and decision 8's write-time output caps for token-heavy tools.
9. **Keep every component removable and measure it.** Several heavy users simplified back to near-default setups as models improved, and the AGENTS.md study found little benefit. The architecture rule that each component is ablatable, and harness decision 18's evals against mini-swe-agent, are the right response to practices whose value models may erode.

## Method and limits

**Extraction.** Throwaway Python scripts flattened all 400 threads into 111,532 comments (story id, comment id, author, date, plain text). Off-topic threads were not removed, but no topic filter matched them meaningfully. Theme filters were regular expressions for plan mode, plan/spec files, implementation plans, TDD, failing tests, type checks, linters, feedback loops, small or atomic tasks, breaking work down, AGENTS.md, CLAUDE.md, rules files, fresh or new sessions, clearing context, context rot, progress files, subagents, worktrees, parallel agents, line-by-line review, review agents, cross-model review, junior and intern analogies, YOLO mode, devcontainers, VMs, bubblewrap, hooks with lint, test or block, CLI over MCP, skills, typed languages, greenfield versus legacy, codebase exploration, dictation, committing often, clarifying questions, Ralph and overnight loops, and "what works for me" phrasing. Most filters also required an agent or model keyword.

**Reading.** I read about 750 comment excerpts, each 250–600 characters. They came from stratified random samples per filter across three periods (2025-05 to 2025-12, 2026-01 to 2026-06, 2026-07 to 2026-11), plus top-level samples from eight workflow threads ([44255608](https://news.ycombinator.com/item?id=44255608), [44836879](https://news.ycombinator.com/item?id=44836879), [45107962](https://news.ycombinator.com/item?id=45107962), [46691243](https://news.ycombinator.com/item?id=46691243), [47034087](https://news.ycombinator.com/item?id=47034087), [47106686](https://news.ycombinator.com/item?id=47106686), [50366117](https://news.ycombinator.com/item?id=50366117), [50538303](https://news.ycombinator.com/item?id=50538303)).

**Counts.** Support counts are distinct usernames whose comments match a filter, and they measure mentions, not endorsements. Where stated, I estimated the endorsing share from a random sample of 16–36 matches; the share ranged from about 40% (fresh context) to 70% (planning). Counter-view counts are lower bounds from reading, not filters. Per-period rates divide distinct authors by comment volume, but they are confounded by thread mix: late 2026 has more product, outage and security threads.

**Biases.** HN skews toward coding agents, senior engineers, Claude Code users and strong opinions, so these findings describe developers working with coding agents more than builders of production agents for end users. Commenters who failed quietly or stopped using agents are under-represented. Vocal heavy users, such as simonw and CuriouslyC, appear in many threads, and the counts treat each author once per claim. The comments are self-reports, and none of them measures outcomes. Model names and product features are as commenters stated them and are unchecked, and the AGENTS.md study and the Claude Code changelog are cited secondhand from comments.
