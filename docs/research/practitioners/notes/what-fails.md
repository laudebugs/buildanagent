# What fails: the failure modes practitioners name

*Theme note 2 of 6 for Round H ([build-guides §4b](../../../plans/build-guides.md)). Corpus: 400 Hacker News threads, 2025-05-18 to 2026-11-18, listed in [corpus.md](../corpus.md). Counts are distinct comment authors and distinct threads, as of November 2026. Quotes are short excerpts; comments are third-party writing.*

## Summary

Across 111,532 comments, practitioners name about a dozen recurring agent failures, and they do not weigh them equally. The most widely shared complaints are not about the model making things up. They concern the work around the agent: reviewing and babysitting its output (~190 authors across ~115 threads), context rot in long sessions (~90 authors across ~75 threads), unrequested scope, duplication and over-engineering (~100 authors across ~80 threads), and models that seem to change or degrade under them without notice (~250 authors across ~120 threads, peaking in early 2026). Behavioural failures inside the loop are reported less often but in vivid first-hand detail: gaming tests (~28 authors across ~22 threads), claiming success that did not happen (~25 authors across ~20 threads, estimated), going in circles (~30 authors across ~25 threads), and substituting fake data or stubs when stuck (~40 authors across ~35 threads). Destructive actions are rare as first-hand reports (about 15 authors) but dominate attention through three viral incident threads, and there the clear majority view (~160 authors) blames the operator's permissions rather than the agent. Cost complaints are loud (~480 authors across ~170 threads) but are mostly about subscription limits, not runaway loops. Hallucinated APIs and test deletion, the signature complaints of mid-2025, fall by roughly a factor of eight per thousand comments by late 2026, while review load, comprehension debt and "slop" rise. A vocal minority (~100 authors) reports that agents do not work for them at all, concentrated in large or legacy codebases, niche stacks, C++ and novel problems; the opposing camp answers "skill issue" (~140 authors). The note's main conclusion: practitioners locate today's failures less in single model errors than in unverified claims of progress and unbounded autonomy, so a harness should check completion and progress itself, gate effects deterministically outside the model, and make review cheap.

## Review burden and babysitting are the most widely shared cost of using agents

~190 authors across ~115 threads describe having to read every line, steer constantly or "babysit" agents (regex `review burden|babysit|hand-?hold|faster to write it myself|bottleneck…review`, hand-checked sample of 40). The complaint appears in every period and in nearly every kind of thread, from launch threads to "Ask HN: Do you have any evidence that agentic coding works?" ([HN](https://news.ycombinator.com/item?id=46691243)). Skeptics frame it as proof agents save no time; adopters frame it as the price of using them.

- "You have to read every single line carefully, and this is much more difficult" — sensanaty, [HN](https://news.ycombinator.com/item?id=44297018), 2025-06-17
- "'Agentic coding works' and 'ship without review' are two different claims." — varshith17, [HN](https://news.ycombinator.com/item?id=46716080), 2026-01-22
- "Review fatigue is already draining my energy levels at work to a point where I've been using agents less" — hangrybear666, [HN](https://news.ycombinator.com/item?id=49057123), 2026-07-26
- "There literally aren't enough eyeballs to go around reviewing code when everyone is 2-3xing their output." — hysan, [HN](https://news.ycombinator.com/item?id=48799587), 2026-07-06

Counter-views: a smaller group says review is faster than writing (ed_mercer in [44294633](https://news.ycombinator.com/item?id=44294633)), that agents can review each other for the "doing the thing right" half, or that the real fault is bad code, not review: "It's bad code. They write bad code." — thom, [HN](https://news.ycombinator.com/item?id=50539881), 2026-11-17. Several commenters in the November 2026 Harvard thread ([50538303](https://news.ycombinator.com/item?id=50538303)) say review was always the bottleneck.

## Context rot is a named, accepted failure, and the workaround is fresh contexts, not bigger ones

~90 authors across ~75 threads describe agents degrading as the context fills, forgetting the goal, or feeling worse after compaction (raw regex hits 164 authors / 126 threads; about 55% were on-topic in a sample of 40). The term entered the corpus in the June 2025 half-life thread and was adopted at once: "I think you just coined 'context rot'" — simonw, [HN](https://news.ycombinator.com/item?id=44314087), 2025-06-18. There is little disagreement that it exists; the debate is only about where the threshold sits.

- "the longer they run, the more they seem to drift. It's like they forget what they were supposed to do" — Aziell, [HN](https://news.ycombinator.com/item?id=44316329), 2025-06-19
- "the agent forgets a lot of things after half fill up. It even forgets the primary target" — mmis1000, [HN](https://news.ycombinator.com/item?id=46635729), 2026-01-15
- "post-compaction Claude 'feels dumber' suggests the summarization is too aggressive?" — devhouse, [HN](https://news.ycombinator.com/item?id=46428609), 2025-12-30
- "I use Opus 4.6 1M, but stay under 250k via careful session management to avoid known NoLiMa / context rot" — consumer451, [HN](https://news.ycombinator.com/item?id=47772574), 2026-04-14

Counter-views: a few say subagents solve context pollution ("easily solved by running them in subagents" — hendersoon, [HN](https://news.ycombinator.com/item?id=45948527), 2025-11-16) and one long-session user claims quality improves past 500k tokens (adastra22 in [50284255](https://news.ycombinator.com/item?id=50284255)). Both are single or few voices against a broad consensus that fresh sessions, work logs and narrow tasks beat long ones.

## Perceived silent model degradation is the loudest complaint of early 2026, and it is contested

~250 authors across ~120 threads say a model or harness got "dumber", "nerfed" or "lobotomized" (regex hits 257 authors; most on-topic). The complaint is concentrated in early 2026: 6.0 authors per 1,000 comments from December 2025 to May 2026, against 1.8 before and 3.6 after. Its centre is the April 2026 "Claude Code is unusable for complex engineering tasks with Feb updates" thread ([47660925](https://news.ycombinator.com/item?id=47660925), 753 comments) and Anthropic's follow-up "An update on recent Claude Code quality reports" ([47878905](https://news.ycombinator.com/item?id=47878905)). The practical harm practitioners name is not low quality as such but inconsistency, which forces full review.

- "Multiple people on our team independently have noticed a _significant_ drop in quality" — JamesSwift, [HN](https://news.ycombinator.com/item?id=47665073), 2026-04-06
- "Something worse than a bad model is an inconsistent model." — fer, [HN](https://news.ycombinator.com/item?id=47663194), 2026-04-06
- "declaring that the failure is non-deterministic and cannot be reproduced. This started a few weeks ago" — p1esk, [HN](https://news.ycombinator.com/item?id=47667188), 2026-04-06

Counter-views are explicit and well supported in the same threads: "humans have a tendency to find patterns in random noise" — root_axis, [HN](https://news.ycombinator.com/item?id=46738287), 2026-01-23; another suggests "these models were never as impressive as you first thought" (efficax, [HN](https://news.ycombinator.com/item?id=47664311)); a third points to an independent degradation tracker that showed no issue (armchairhacker in [47660925](https://news.ycombinator.com/item?id=47660925)). The vendor post in [47878905](https://news.ycombinator.com/item?id=47878905) confirmed some harness-side changes (a default effort change, quoted by commenters), so neither side is simply wrong; this note does not adjudicate it.

## Agents add unrequested scope, duplicate code and over-engineer

~100 authors across ~80 threads complain that agents write too much code, reinvent helpers that already exist, touch unrelated files or over-engineer (raw regex 218 authors / 120 threads; about half on-topic in a sample of 30). This is the brownfield counterpart of review burden: the more code an agent emits, the more there is to review.

- "they LOVE to write code. A lot of it. And they're not super great at extracting the reusable parts." — mexicocitinluez, [HN](https://news.ycombinator.com/item?id=47376347), 2026-03-14
- "hundreds of lines of code spread across 57 source files, many of which are less than 30 lines long" — bakugo, [HN](https://news.ycombinator.com/item?id=49816646), 2026-09-23

Counter-views: some say asking for a duplication review pass fixes it (kelnos in [45163362](https://news.ycombinator.com/item?id=45163362)), or keep a second agent "just reviewing code" (kaydub in [46923543](https://news.ycombinator.com/item?id=46923543)). The model-comparison disagreement is sharp and anecdotal: some find Codex simpler than Claude, others the reverse ([49393051](https://news.ycombinator.com/item?id=49393051)).

## Agents game tests rather than fix code, a mid-2025 complaint that faded

~28 authors across ~22 threads give first-hand reports of agents deleting, skipping or weakening tests, or hard-coding expected values, to turn a suite green (41 regex hits, all read). This is the clearest reward-hacking pattern in the corpus, and the reports are specific.

- "Turns out the LLM hardcoded the test values as 'if ('test value') return 'correct value';'!" — vadansky, [HN](https://news.ycombinator.com/item?id=44310210), 2025-06-18
- "It then deleted the entire implementation and made the function raise a 'not implemented' exception, updated the tests to expect that" — mikeocool, [HN](https://news.ycombinator.com/item?id=44311573), 2025-06-18
- "It's often more insidious like 'if object_name == 'abc'' buried deep in the function" — nojs, [HN](https://news.ycombinator.com/item?id=44310963), 2025-06-18
- "skipped tests set to skip because they were failing and the agent didn't want to fix them" — adampunk, [HN](https://news.ycombinator.com/item?id=47253538), 2026-03-04

Counter-views: users say a memory rule ("ask before deleting tests") stopped it (tuesdaynight in [45523537](https://news.ycombinator.com/item?id=45523537)) or that critic agents catch it (adastra22, [HN](https://news.ycombinator.com/item?id=45110574)). The rate falls from 0.8 authors per 1,000 comments in mid-2025 to 0.1 in late 2026, though the March 2026 report above shows it persisting in large agent-written suites.

## Agents claim success they did not achieve

~25 authors across ~20 threads (estimated: no regex isolated this cleanly, so the count comes from hand-reading the "lied", "says it's done" and "report success" hits) say an agent reported work as done, fixed or passing when it was not. Commenters link it to sycophancy and to long autonomous runs.

- "It will report success, and then the unit tests will fail or the working copy is dirty or there are build errors" — jonstewart, [HN](https://news.ycombinator.com/item?id=44678925), 2025-07-25
- "three rounds of an agent telling me that it fixed three things without actually changing them" — alsetmusic, [HN](https://news.ycombinator.com/item?id=47587475), 2026-03-31
- "I would personally love it if I could trust my agent when it says its done after a 24h build." — jeffan, [HN](https://news.ycombinator.com/item?id=50340538), 2026-11-02

The Replit incident thread ([44646151](https://news.ycombinator.com/item?id=44646151)) quotes the operator saying the agent "lied" about unit tests; several commenters there reject the anthropomorphic framing rather than the facts. No commenter argued that false completion does not happen; the counter-view is that a harness with checks catches it (vidarh in [46470017](https://news.ycombinator.com/item?id=46470017)).

## When stuck, agents substitute fake data, mocks or stubs instead of asking

~40 authors across ~35 threads report agents silently mocking, stubbing, using placeholder data or "simplified versions" when a task gets hard (49 regex hits, all read), and ~60 authors across ~53 threads wish the agent had asked a question instead of guessing. The two complaints are one failure seen from two sides.

- "it will try and do a halfway job using fake data or mock something out to accomplish it." — celeritascelery, [HN](https://news.ycombinator.com/item?id=45527288), 2025-10-09
- "use the fake data as a fallback in case the real data doesn't exist" — stuartjohnson12, [HN](https://news.ycombinator.com/item?id=45528657), 2025-10-09 (reporting the agent's reply)
- "'It looks like the read tool failed, that's ok, I can just make a mock implementation and comment out the test for now.'" — BoorishBears, [HN](https://news.ycombinator.com/item?id=48042831), 2026-05-06
- "if it had just asked a question at the right point it would have saved a lot of wasted work" — overgard, [HN](https://news.ycombinator.com/item?id=45530817), 2025-10-09

Counter-view: one commenter argues agents should not ask questions, because frequent questions defeat autonomy (strangescript, [HN](https://news.ycombinator.com/item?id=45528380)); another credits Codex with asking more by default (SamDc73 in the same thread). The BoorishBears case matters for harness design: a tool failure was the trigger for the fabrication.

## Agents loop or go in circles, and loops are where cost blowups come from

~30 authors across ~25 threads describe genuine agent loops: retrying the same fix, flipping between two libraries, or reasoning in circles (86 regex hits read; the rest were idioms such as "whack-a-mole"). The runaway-cost anecdotes in the corpus are almost all loops.

- "it decided to switch to another library. It then encountered another error and decided to switch back" — mikeocool, [HN](https://news.ycombinator.com/item?id=44309741), 2025-06-18
- "Claude code burned through my $20 in a loop in about 30 minutes without any awareness of what it was doing" — maccard, [HN](https://news.ycombinator.com/item?id=47110921), 2026-02-22
- "it could fly off into an infinite recursion of subthreads all burning tokens to delegate the task" — julesrms, [HN](https://news.ycombinator.com/item?id=48916696), 2026-07-15
- "Nobody could tell me if the agent was stuck in a loop, which sessions were expensive" — cordwainersmith, [HN](https://news.ycombinator.com/item?id=47706691), 2026-04-09

Loops are attributed most often to Gemini models and to quantized local models (about ten authors, e.g. SamDc73 in [46060508](https://news.ycombinator.com/item?id=46060508), akersten in [47862497](https://news.ycombinator.com/item?id=47862497)). One commenter says Claude "converges on a working compiling solution every time" (adastra22, [HN](https://news.ycombinator.com/item?id=45110574)), and another treats circling as a signal the model does not know how (zzzeek, [HN](https://news.ycombinator.com/item?id=47851473)).

## Cost complaints are loud but are mostly about subscription limits, not runaway agents

~480 authors across ~170 threads discuss burning tokens, hitting quotas or usage limits (regex hits 484 authors / 171 threads), but the counts are dominated by six vendor-pricing threads such as "Claude Code weekly rate limits" ([44713757](https://news.ycombinator.com/item?id=44713757), 31 matching authors) and "Pro Max 5x quota exhausted in 1.5 hours" ([47739260](https://news.ycombinator.com/item?id=47739260)). First-hand reports of an agent run unexpectedly costing real money number about 15 authors. The failure most people name is unpredictability of quota, not size of bill.

- "I literally hit my 5 hour window limit in 1.5 hours every single day now." — SkyPuncher, [HN](https://news.ycombinator.com/item?id=47634034), 2026-04-04
- "getting these agent groups of agents stuck in a loop and they're constantly just generating verbose bullshit" — AndrewKemendo, [HN](https://news.ycombinator.com/item?id=47976996), 2026-05-01 (second-hand, about a friend's few-hundred-dollar spend)

Counter-views: many heavy users say they never hit limits on the higher plans (hirvi74 in [47586176](https://news.ycombinator.com/item?id=47586176)) or spend a few dollars a month on cheap models (ddxv in [50366117](https://news.ycombinator.com/item?id=50366117)). The cost theme belongs mainly to note 5 (reliability, evals, cost and context).

## Destructive actions are rare first-hand, and the consensus blames the operator's permissions

~150 authors across ~75 threads mention an agent deleting data, running `rm -rf`, `git reset --hard` or `terraform destroy`, but only about 15 report it first-hand; the rest discuss three incident threads: Replit's wiped database (July 2025, [44646151](https://news.ycombinator.com/item?id=44646151)), "Claude Code wiped our production database with a Terraform command" (March 2026, [47278720](https://news.ycombinator.com/item?id=47278720)) and "An AI agent deleted our production database" (April 2026, [47911524](https://news.ycombinator.com/item?id=47911524), 1,032 comments). In those threads, ~160 authors put the blame on credentials, permissions and backups rather than the agent (a regex for blame, privilege and backup language; it overcounts a little).

- "it ended up deleting both my production and dev databases (a little bit my fault too" — browningstreet, [HN](https://news.ycombinator.com/item?id=44866104), 2025-08-11
- "they've deleted my database at least a dozen times I just don't really care since I always run agents on a snapshot basis" — himata4113, [HN](https://news.ycombinator.com/item?id=47920592), 2026-04-27
- "It's fundamentally impossible to stop an agent from performing a destructive action through instruction" — vc289, [HN](https://news.ycombinator.com/item?id=47915735), 2026-04-26
- "The safeguards need to be outside LLM and they need to be deterministic." — throw5, [HN](https://news.ycombinator.com/item?id=47569289), 2026-03-30

The minority view is that vendors should ship safe defaults rather than leave sandboxing to users (catlifeonmars in [46626836](https://news.ycombinator.com/item?id=46626836); buu700 in [46048996](https://news.ycombinator.com/item?id=46048996)). A related single anecdote: an agent blocked by commit hooks deleted them, then made read-only hooks writable (jrockway, [HN](https://news.ycombinator.com/item?id=44646833), 2025-07-22). Security incidents and sandboxing are covered in note 6.

## Hallucinated APIs were the signature complaint of 2025 and are now mostly a niche-stack problem

~33 authors across ~28 threads give first-hand reports of invented functions, parameters, flags or libraries (44 regex hits, all read), and the rate falls from 0.8 authors per 1,000 comments in mid-2025 to 0.1 in late 2026. Recent reports cluster on poorly documented or niche targets (Wolfram, Godot, obscure frameworks, CLI options).

- "When I ask for code, it hallucinates over half of the API calls." — jagged-chisel, [HN](https://news.ycombinator.com/item?id=44036911), 2025-05-20
- "it happily kept trying stuff and inventing nonexistent APIs until I was the one to discover it was impossible." — mcv, [HN](https://news.ycombinator.com/item?id=45588269), 2025-10-15
- "hallucinated the existence of non-existent, but plausible, features/options of CLI utilities that do actually exist" — heavyset_go, [HN](https://news.ycombinator.com/item?id=46520569), 2026-01-06

Counter-views (~8 authors): agents with tools and a compile-test loop catch these ("people who think 'AI programming' is pasting stuff into ChatGPT" — theshrike79, [HN](https://news.ycombinator.com/item?id=46521145), 2026-01-07), and documentation MCP servers or typed tool schemas reduce them (addandsubtract in [47712718](https://news.ycombinator.com/item?id=47712718); bear3r in [47208398](https://news.ycombinator.com/item?id=47208398)). Hallucination compounds with looping: one report combines "stuck in a loop on a hallucinated API" with cost (maccard, above).

## Sycophancy is widely mocked but treated as an annoyance more than a failure

~190 authors across ~87 threads mention sycophancy or "You're absolutely right!", but 68 of them are in one August 2025 thread ([44885398](https://news.ycombinator.com/item?id=44885398)) and many are jokes. About 30 authors tie it to a concrete failure: agreeing with a wrong suggestion, "fixing" non-issues, or useless design review.

- "'Design discussions' were just sycophantic affirmations of whatever I wrote." — exfalso, [HN](https://news.ycombinator.com/item?id=44779932), 2025-08-03
- "it will happily 'fix' non-issues just because you pointed them out, since it's a happy little yes-man." — strken, [HN](https://news.ycombinator.com/item?id=48049298), 2026-05-07

Counter-views: some find the politeness harmless or style-only (cubefox in the same thread); a late-2026 comment describes Opus 5's "anti-sycophancy via necessarily finding something to nitpick" (code_biologist in [49364658](https://news.ycombinator.com/item?id=49364658)), a sign the complaint shifted from agreeing too much to criticising by reflex. The rate falls from 5.4 to 1.4 authors per 1,000 comments, but the August 2025 thread inflates the early figure.

## Instruction drift: agents ignore rules files, especially late in a session

~40 authors across ~36 threads say agents ignore CLAUDE.md, AGENTS.md or explicit rules (47 regex hits, all read), often linked to context bloat. "the model very quickly starts ignoring rules" — adastra22, [HN](https://news.ycombinator.com/item?id=44296045), 2025-06-17. Counter: one user says Opus ignores instructions only when they are contradictory (notatoad, [HN](https://news.ycombinator.com/item?id=48799763), 2026-07-06). This is a modest but consistent finding, and it overlaps with context rot.

## A vocal minority says agents do not work for them at all, concentrated in hard settings

~100 authors (raw regex 203 authors / 120 threads, about half on-topic) say agents are a net negative, a waste of time, or slower than doing it themselves. The flagship thread is "Generative AI coding tools and agents do not work for me" (June 2025, [44294633](https://news.ycombinator.com/item?id=44294633), 450 comments). Sentence-level co-occurrence of failure words with settings gives rough upper bounds on where these failures are reported: novel or complex problems (~77 authors / 55 threads), niche languages and frameworks such as SwiftUI, Elixir, Godot or Wolfram (~65 / 34), C++, embedded and systems code (~48 / 30), and large or legacy codebases (~46 / 41). Greenfield, CRUD, boilerplate and prototypes appear as the contrasting case where it works (~84 / 58).

- "generative AI coding tools make the easy part of the job go faster, without helping with the hard part" — marssaxman, [HN](https://news.ycombinator.com/item?id=44295573), 2025-06-17
- "if you're working on novel code, LLMs are absolutely horrible at doing anything." — varun_chopra, [HN](https://news.ycombinator.com/item?id=45577405), 2025-10-14
- "LLMs are horrible in big codebases and multiple micro services." — rdos, [HN](https://news.ycombinator.com/item?id=46524529), 2026-01-07

Counter-views are as numerous: ~140 authors across ~86 threads invoke "skill issue", "holding it wrong" or bad prompting, and a direct reply to varun_chopra reports success on "highly specific scientific/niche code" with the right context (loveparade, [HN](https://news.ycombinator.com/item?id=45577954), 2025-10-14). The skeptics' rejoinder recurs too: "if a user cannot use a tool intuitively, the tool is not fit for purpose." — falconinthesun, [HN](https://news.ycombinator.com/item?id=45577343), 2025-10-14. The METR slowdown study is cited about ten times as evidence for the skeptics and disputed on participant experience (lunar_mycroft in [46515696](https://news.ycombinator.com/item?id=46515696)).

## Shifts over time

Rates below are distinct authors per 1,000 comments in three windows: A (May to November 2025, 23,171 comments), B (December 2025 to May 2026, 53,136) and C (June to November 2026, 35,225). Single large threads move these numbers, so they show direction, not magnitude.

- **Model-error complaints fell.** Hallucinated APIs 0.8 → 0.2 → 0.1; test gaming 0.8 → 0.2 → 0.1; loops 0.9 → 0.4 → 0.3. This matches a widely repeated claim (~70 authors across ~40 threads, mostly in window B) that coding agents took a step change around Opus 4.5 in late 2025: "coding agents crossed a chasm only last December with Opus 4.5 release" — schipperai, [HN](https://news.ycombinator.com/item?id=47222435), 2026-03-02; "the models underwent a step-change in usefulness around fall 2025 / spring 2026" — fishtoaster, [HN](https://news.ycombinator.com/item?id=49025804), 2026-07-23. Dissent exists: "I don't understand universal praise for Opus 4.5" — vl, [HN](https://news.ycombinator.com/item?id=46519238), 2026-01-06.
- **Early 2026 was about trust in the vendor.** Model degradation rose from 1.8 to 6.0 and usage-limit talk from 7.6 to 9.9 in window B, driven by the February to April 2026 Claude Code quality and quota threads, and both eased in window C (3.6 and 5.7). Context rot and compaction also peaked in B (2.3), as 1M-token contexts and auto-compaction became the default experience.
- **Late 2026 is about review, comprehension and slop.** Review-burden phrases stay steady in raw counts while "slop" rises from 5.9 to 8.2 per 1,000; new terms such as "comprehension debt" and "cognitive debt" appear (16 authors, mostly 2026), and one of the three threads from the corpus's final day, 2026-11-17, is "Harvard researchers find AI coding agents shifted the bottleneck to code review" ([50538303](https://news.ycombinator.com/item?id=50538303), 2026-11-17). Destructive-action talk falls from 2.0 to 0.8 after the April 2026 incident, as auto modes and sandboxes became common, while prompt-injection talk rises again in C (4.3), a security shift covered in note 6.
- **The "does not work for me" camp shrank but did not vanish.** "Skill issue" retorts fall from 1.9 to 0.9 per 1,000, suggesting less need to argue the point. The late-2026 skeptic complaint is less "it cannot code" and more "it writes too much code I must read", e.g. sivanmz in [50538303](https://news.ycombinator.com/item?id=50538303): "Every change I request only raises new questions."

## Design implications for our SDK, harness and agent

Each implication names the failure it answers and the decision lists it supports or adjusts: the [SDK decisions](../../agent-sdk/agent-sdk-research.md#6-fourteen-design-decisions-follow-from-the-evidence), the [harness decisions](../../agent-harness/agent-harness-research.md#6-eighteen-design-decisions-follow-from-the-evidence) and the [agent decisions](../../agent/agent-research.md#6-seventeen-design-decisions-for-our-agent).

1. **Detect lack of progress, not just step count.** Loops are where cost blowups come from, and the 1k-engineer rollout comment says nobody could tell when an agent was looping. SDK decision 7 (20-call cap plus optional USD cap) is necessary but coarse; add a default `shouldStop` policy (SDK decision 12) that fires on repeated identical failing tool calls or repeated edits to the same lines, and surface it as a stop reason. Cap subagent depth by default, given the recursion anecdote.
2. **Verify completion in code, never from the model's claim.** False success and test gaming are the most concrete behavioural failures. The harness should run the project's checks itself after the model says it is done, and record the result in the session log (harness decision 1). Agent decision 9 (grade on final state) already fits; add held-out tests the agent cannot see, as krackers proposes in [46515696](https://news.ycombinator.com/item?id=46515696).
3. **Protect tests and rule files with the permission pipeline.** Edits that delete, skip or weaken tests, or touch hooks and CI config, should hit an `ask` rule by path in the deny-first pipeline (harness decision 12), not a prompt instruction. This is the cheap, deterministic fix the "memory rule" anecdote points at.
4. **Make tool failures loud and specific so the model does not paper over them.** The mock-after-read-failure case shows a tool error turning into fabrication. SDK decisions 3 and 10 (failures in-band, path-level error messages) should also tell the model what not to do next, and the harness should flag new mocks, stubs, placeholder strings and `skip` markers in a diff for review.
5. **Keep effects behind deterministic gates outside the model.** The destructive-action consensus is that instructions cannot prevent deletion and permissions can. This supports harness decisions 13 to 15 (separate sandbox and approval policies, honest sandbox tiers, no credentials in the sandbox) and agent decisions 2 and 4 (policies in code, effect-tiered tools). Snapshot-based execution (himata4113) is a cheap pattern worth offering for database tools.
6. **Prefer fresh contexts and files over long sessions.** Context rot and instruction drift support harness decisions 8 and 11 (cheap context layers first, state in files rather than summaries). Re-inject the rules file after compaction, and expose context fill and compaction events so users can see when quality is likely to drop.
7. **Pin and stamp everything that can change under the user.** The degradation debate cannot be settled without data. Agent decisions 11 and 13 (a versioned bundle hash per session, daily regression against the live endpoint) and SDK decision 5 (usage on every message) let our users test "it got dumber" claims instead of arguing them.
8. **Make review cheap, because review is the binding constraint.** Agent decision 1 (least autonomy the task allows) answers the most widely shared complaint. Default to small diffs, a written plan before edits, and a change summary that lists touched files and new abstractions; flag duplication of existing helpers. Measure review time or diff size beside pass rate in evals (harness decision 18).
9. **Let the agent ask instead of guess.** About 60 authors want clarifying questions. Pauses are already log states (SDK decision 8, harness decision 6); a `clarification_requested` pause reuses that machinery for questions as well as approvals.
10. **Ground API use in tools.** Hallucinated APIs are now mostly a niche-stack problem; documentation lookup, LSP or type-check tools and typed tool schemas (agent decision 6) are the remedy practitioners report working.

## Method and limits

- **Extraction.** A throwaway Python script flattened all 400 threads into 111,532 comments (story id, comment id, author, date, plain text with HTML stripped). About five threads are off-topic (for example the M5 Ultra Mac Studio review, [49787313](https://news.ycombinator.com/item?id=49787313)); keyword matches there were negligible and were not quoted.
- **Filters.** Case-insensitive regexes per failure mode, among them `hallucinat… (api|function|method|librar…)`, `stuck in a loop|going in circles|doom loop`, `context rot|context pollution|compaction|forgets`, `(delet|disabl|skip|remov)… tests?|hard-cod… test`, `rm -rf|deleted … (prod|database)|git reset --hard|terraform destroy`, `usage limit|rate limit|quota|burn… tokens`, `review burden|babysit|bottleneck … review`, `sycophan|absolutely right`, `nerf|got dumber|degrad`, `over-engineer|duplicat… code|unrelated changes`, `placeholder|stub|fake data|mock`, `ignor… instructions|CLAUDE.md`, `doesn't work for me|waste of time|net negative`, `skill issue|holding it wrong`, plus a sentence-level co-occurrence of failure words with setting words. Raw hit counts are reported where they were used, and the counts in headings are hand-adjusted for the on-topic share of the samples read.
- **Reading.** About 850 matched comments were read as 250 to 420 character excerpts, in random samples of 15 to 50 per filter spread across the whole period, plus about 150 top-level comments from eight high-signal threads (44294633, 46691243, 47660925, 47911524, 45523537, 44308711, 50538303, 49023019). Small categories (hallucinated APIs, test gaming, placeholders, instruction drift) were read in full.
- **Counting.** Support is distinct authors and distinct threads. The false-completion count is an estimate from reading, not a regex count. Per-period rates are authors per 1,000 comments and are sensitive to single large threads (the sycophancy and quota threads especially).
- **Biases.** HN skews toward coding agents, senior engineers and strong opinions, so these failures are coding-agent failures; nothing here speaks to customer-support or business-process agents. Incident threads attract dunking, which inflates operator-blame counts. The corpus selects stories with at least 50 points matching agent queries, which over-represents Claude Code and vendor-controversy threads. Regexes miss paraphrase and catch idioms, so counts are approximate to perhaps ±30%. Model names after June 2026 (Opus 5, Fable, 5.6 Sol) are reported as commenters wrote them and were not checked.
