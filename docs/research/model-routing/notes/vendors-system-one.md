# Vendor "System 1" models and how vendors say to combine them with reasoning models

Raw research notes. Researched 2026-11-28 ("as of November 2026"). All figures are as quoted on the cited page. Anything labelled "vendor claim" is the vendor's own number and was not independently reproduced. "Secondary" = search snippet, blog or news write-up, not the vendor's own page.

Method note: TypeSafe pages were downloaded as `.md` and read from local copies (docs index: https://docs.typesafe.ai/llms.txt). Several pages (primitives/choice, score, noul, box; cookbooks langchain_safety_gate, parallel_questions, llm_guardrails) are long; I read prose and tables in full but only skimmed the code blocks. Other vendor pages were read through a summarising fetch tool, so numbers from those are quoted from its output of the official page; re-check any figure before it goes into the book.

---

## Part A. TypeSafe AI (docs.typesafe.ai)

### A1. Definitions

- System One model: "a class of AI models built to make fast, structured decisions that software can use directly. A System One model evaluates a state and returns typed answers and probabilities." (https://docs.typesafe.ai/concepts/system-one.md)
- Name origin: "comes from the concept Daniel Kahneman popularized in his book Thinking, Fast and Slow. System 1 thinking is fast and intuitive. System 2 is slower and more deliberate. Here, the emphasis is on fast, focused judgments." (same page)
- Jev: "TypeSafe's flagship model and the first System One model." (https://docs.typesafe.ai/introduction.md)
- Versus an LLM: System One models "do not write replies, produce code, or generate explanations of their reasoning"; they are "trained for calibrated decisions: their probabilities are optimized against outcomes to reflect uncertainty. Calibration is measured across groups of predictions; it does not guarantee that an individual answer is correct." (https://docs.typesafe.ai/concepts/system-one.md)
- Training story (https://docs.typesafe.ai/introduction/machine-learning-primer.md):
  - RLHF: "turned pretrained models into chatbots. It trains models to produce responses people prefer." Criticised as rewarding sycophancy, confident-sounding hallucination, and "mode dropping".
  - RLVR: "created reasoning models that are strong at tasks such as mathematics, but slower and more expensive."
  - RLCD (Reinforcement learning for calibrated decisions): "trains Jev to return decisions and calibrated probabilities instead of generated text." Output contract: no text; decisions plus probabilities; "Higher probability should correspond to a greater chance that the answer is correct." Calibration: 0.2 should happen about 20% of the time, 0.8 about 80%; "These rates describe groups of predictions, not a guarantee about any single answer."
  - They call the goal "Machine Native Intelligence": "AI with software-like properties such as structure, reliability, observability, testability, speed, consistency, and low cost." Stated expectation: automation "closer to 99% machine-to-machine interactions and 1% human interaction."
- Three architectures (https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md): traditional software; LLM agents ("An agent processes instructions and chooses its next step... every loop introduces another opportunity to go off the rails"); "AI-powered software" (code owns control flow, the model appears "only where the system needs programmable common sense or needs to interpret unstructured data"). Jev is "not agents. It does not generate code or choose its own next action."
- Summary rule on that page: "build a normal software workflow and insert Jev only where AI is needed." Keep control flow, deterministic rules, side effects in code; narrow typed questions; only needed context; use probabilities/confidence to act, review or escalate; ask independent questions together and compose in code.
- Launch post (secondary-to-docs but vendor's own blog, https://typesafe.ai/blog/introducing-system-one-models-and-jev): header date Sep 15, 2026 (page metadata says Nov 16, 2026). Jev "in early access", "being moved off a waitlist". Contrasts System One (structured program state in, typed outputs with calibrated probabilities out, parallel sampling) with LLMs (sequential token generation).

### A2. Primitives and what each returns

Sources: https://docs.typesafe.ai/primitives.md and the pages under /primitives/.

| Primitive | Question shape | Returns | Notes |
| - | - | - | - |
| Choice | Which of these options? | `choice`, `probabilities` (per option), `confidence` | Always picks one even if none fit. Pair with a companion Noul rather than an `other` option. Option order can bias the answer (model-jaggedness page). |
| Score | Which level on an ordered rubric? | `score` (can fall between levels), `legend`, `probabilities` per level, `confidence` | 2 to 10 levels ("at least two levels; the API accepts up to 10", /primitives/score.md). Same score can come from different distributions, so read probabilities. |
| Noul | Is this true? | `noul` (0 to 1, probability of yes) | No separate `confidence`. "A good starting point is 0.7 for yes and 0.3 for no." |
| Box | Where is it in this image? | `box` {top,bottom,left,right as 0..1 fractions}, `confidence` | Needs Jev 1.14 and header `TypeSafe-Danger-Zone-Images: true`. Page labels it "Dreamer-ready" (not production-ready). Always returns a location, so pair with a Noul for presence. |

- Request: `state` (string, object or array) + `questions` (map of id to {type, instructions, criteria}) + `model`; optional `assets` for images. Question ids are for your code only, not sent to the model. (https://api.typesafe.ai/openapi.json, https://docs.typesafe.ai/primitives.md)
- Every answer is constrained to the options supplied; answers within one request are independent ("One question's answer is not hidden context for another") and evaluated in parallel.
- "Ask for one snap judgment per question": "'Does this message convey urgency?' is a good question. 'Analyze this message and determine the best course of action' is not. That needs slow reasoning, and it is a signal to break the task into small questions and compose the answers in code." (https://docs.typesafe.ai/primitives.md)
- Advanced structure: `instructions`, Choice option descriptions, Score level descriptions and Noul `true`/`false` criteria may be string, object, array or null (JSON structure; models "trained to understand structure"). Backticked dot/index paths (e.g. `ticket.messages[0].text`) point a question at part of the state. (https://docs.typesafe.ai/primitives/advanced.md)
- Choice vs Score vs Noul guidance: Noul 0.5 does not mean "medium"; use Score for degree. (https://docs.typesafe.ai/primitives/noul.md, https://docs.typesafe.ai/primitives.md)

### A3. Confidence and probabilities: how they drive act vs escalate

Source: https://docs.typesafe.ai/confidence.md unless noted.

- `confidence` is derived from the returned `probabilities`; it is not the probability the answer is correct.
  - Choice with n options: `(p_max - 1/n) / (1 - 1/n)`. Only the top probability counts.
  - Score: uses distance-weighted spread from the most likely level; neighbouring-level probability lowers confidence less than far-away probability. Floored at 0.
  - Noul: no confidence; optional `|2p - 1|` if you want one.
  - Table in the page: 2 options top prob 0.75 gives confidence 0.5; 3 options 0.67; 10 options 0.55.
- Three-path starting pattern: high probability = act automatically; medium = proceed with caution (confirm, flag, gather more info); low = do not act (human, clarify, or fall back to a different system).
- "Thresholds scale with risk." Worked example on the page: if p < 0.67 route to human; read-only action (check_balance) acts; destructive action (approve_transfer) needs p > 0.93, otherwise ask user to confirm. Caveat on the same page: "The correct threshold values depend on your domain... Start with conservative thresholds, test with your own data, and adjust."
- What to threshold:
  - Noul: the value itself; 0.7 / 0.3; give the 0.3 to 0.7 band its own outcome.
  - Choice: probability of the option the code will act on (`probabilities[choice]`), not `confidence`.
  - Score: check `confidence` first when you need to know if the answer is clear at all; if one level boundary decides the action, sum probabilities of the levels on the side that matters.
- The docs name "a more expensive reasoning model" as an escalation target: "so you can decide when to act and when to escalate to a person or a reasoning model." (https://docs.typesafe.ai/concepts/system-one.md); "Escalate uncertain cases to a person or a more expensive reasoning model. Test thresholds by plotting confidence against accuracy on your data." (https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md)
- Calibration/benefit claims are TypeSafe's own: "Higher confidence means higher accuracy" etc. (launch post).

### A4. Patterns and their decision rules

Index: https://docs.typesafe.ai/patterns.md. Each pattern splits a decision into small questions and leaves the decision to code.

1. Speculative fan-out (https://docs.typesafe.ai/patterns/fan-out.md)
   - Put every question the system might need in one request, including ones relevant only on some paths; code ignores irrelevant answers. Example: category Choice + bug severity Score + reproducible-steps Noul + refund Noul + frustration Score in one call.
   - Rule examples: `bug_report` and severity > 1.5 and repro noul > 0.6 -> escalate to engineering; billing and refund noul > 0.7 -> flag refund; frustration score > 1.5 -> priority.
   - Benefit: cost and speed. Vendor claim (https://docs.typesafe.ai/cookbooks/parallel_questions.md): 13-question GDPR briefing in one call vs 13 calls: "12.2x cheaper, 11.8x faster"; printed table: one call $0.000497 / 0.24s vs 13 calls $0.006090 / 2.81s.
2. Screen with a Noul first (https://docs.typesafe.ai/patterns/noul-screen.md)
   - Ask one cheap yes/no question on a small state; run the expensive step only on a clear yes.
   - Rule: noul < 0.3 -> file away; noul > 0.7 -> fetch customer record and run full triage; between -> queue for a quick look. Example five-message table: values 0.98, 0.44, 0.10, 0.02, 0.02.
   - When worth an extra request: the next step has a bigger state, a slower model (an LLM call), or a person. Otherwise use fan-out.
   - "Other ways to screen": "Run the cheap step, ask a Noul whether its output is right, and send only the outputs that fail that check to the expensive model." (this is the cascade, see A5.)
3. Companion Noul (https://docs.typesafe.ai/patterns/companion-noul.md)
   - Choice always picks something. Add a Noul "does any option fit?"; use the Choice only when the Noul is a clear yes.
   - Rule: about_ours < 0.3 -> general inbox, ignore the Choice; about_ours > 0.7 and product probability > 0.7 -> product team; else a general agent with the Choice as a hint.
   - Claim: `other` option "competes with your real options for probability"; companion Noul "usually works better" ("in our tests").
   - Alternative: one Noul per option.
4. Routing by confidence (https://docs.typesafe.ai/patterns/confidence-routing.md)
   - Bug severity Score 0 to 4. Rule: confidence < 0.5 -> triage person; score < 1.5 backlog; < 2.5 sprint; else page on-call. Example row: score 3.19 / confidence 0.34 goes to triage.
   - Split-answer caveat: neighbouring-level split can pass the confidence check; use summed probability, e.g. `p[3] + p[4] >= 0.3` -> message on-call.
5. Routing by probability (https://docs.typesafe.ai/patterns/probability-routing.md)
   - Voice banking intent Choice. Rule: p < 0.7 -> human support; check_balance acts at >= 0.7; approve_transfer: > 0.9 opens a confirmation screen, 0.7 to 0.9 asks the user to clarify. "The thresholds only choose which workflow runs; none of them moves money." A hesitant utterance still got 0.99, so intent probability is not user consent.
   - "Why not confidence?" For a fixed-option Choice, confidence is a transform of the top probability.
6. Composite scoring (https://docs.typesafe.ai/patterns/composite-scoring.md)
   - Several atomic Scores normalised to 0..1 and weighted in code (senior IC: 0.40/0.10/0.40/0.10; engineering manager: 0.15/0.40/0.20/0.25). Change weights, not prompts.

### A5. Cookbooks

SDE cascade (https://docs.typesafe.ai/cookbooks/sde_cascade.md) - the cheap-model / System 1 verifier / reasoning-model cascade
- Flow:
  1. Answer with a cheap model (rung 0: `gpt-6-luna`) as JSON matching a schema.
  2. Verify with Jev (`jev-1.14.0`): one Noul per rule the answer must follow, framed so true = rule broken; six rules (busy_conflict, outside_hours, breaks_preference, not_earliest, wrong_length, no_single_time); all in one `system_one` call; state = task + cheap answer.
  3. Escalate to the reasoning model (rung 1: `gpt-6.1-sol` with `reasoning_effort="high"`) if the answer fails the schema or any rule's P(broken) exceeds `FIRE_T = 0.7`; otherwise keep the cheap answer.
- Decision rule: `escalate = schema_invalid or any(p > 0.7)`. Page says: "a `max`-style check, not a mean, so one confident red flag is enough instead of being averaged into silence"; "the verifier has to cost far less than the reasoning rung, or the cascade saves nothing."
- Why a verifier: "72 of luna's 74 wrong answers pass the schema check, so only Jev's rule checks can catch them."
- Data: 1,000 NATURAL PLAN calendar-scheduling tasks; numbers from `jev-1.14.0` on 2026-11-05 (vendor claims, vendor-run):
  - luna alone: 92.6% right at $0.16 per 1,000 tasks; sol-high alone: 98.1% at $1.89.
  - threshold 0.58: 27 of 1,000... (printed table) escalated 2.7%, 94.9% right, $0.261; threshold 0.29: 13.3% escalated, 96.5%, $0.490 ("about a quarter of sol-high's cost"); threshold 0.18: 53.6% escalated, 98.1%, $1.307; threshold 0.16: 64.1%, 98.3%, $1.500.
  - "Jev's checks cost $0.04 per 1,000 tasks."
- Applicability: "A cascade pays when the cheap model is right most of the time and its mistakes break rules a check can see."

Verify LLM outputs (https://docs.typesafe.ai/cookbooks/verify_llm_outputs.md)
- Three Noul questions per answer (`answerable`, `declines`, `supported`) combined into one risk number; risk >= 0.2 goes to review. Measured on 1,000 MuSiQue questions answered by `gpt-6-luna` (vendor-run, jev-1.14.0, 2026-11-07): 88.5% of answers right; check passed 73% of answers and 95.7% of those were right; the 27% sent to review included 84 of 115 wrong answers; 189 of the 273 held back were actually right. Misses: 31 wrong answers passed (18 answered a related question).
- Table: risk < 0.2: 727 used, 95.7% right, 84/115 held back; < 0.3: 825, 94.2%, 67; < 0.5: 917, 91.9%, 41; < 0.7: 965, 90.3%, 21.
- Caveat on the page: labels come from models; threshold choice was tuned on the first 100 questions.

Citation check (https://docs.typesafe.ai/cookbooks/citation_check.md)
- String match first (no model needed for fabricated quotes), then one Choice per surviving citation (`verified`, `unsupported`, `contradicted`, ...). `AUTO_ACCEPT = 0.8`: confidence >= 0.8 verdict stands; below, a human confirms. 8 citations on RFC 7519: 4 accurate all `verified` at >= 0.98; all 4 planted failures caught; one `unsupported` at 0.56 went to a human. Tiny test (vendor-run).

LLM guardrails (https://docs.typesafe.ai/cookbooks/llm_guardrails.md)
- One request per message: five Noul hazard questions + one severity Score. Per-hazard action threshold and lower review threshold (>= review -> human; >= action -> configured action); severity Score can upgrade a review to a block. Policies = named threshold sets ("strict", "permissive"). Run on inputs and outputs. Positioning: "Put a second LLM in front of the first and you pay a call's worth of latency and money on every turn, and an attacker can talk that one past too."

LangChain quickstart and safety gate (https://docs.typesafe.ai/cookbooks/langchain_quickstart.md, https://docs.typesafe.ai/cookbooks/langchain_safety_gate.md)
- `TypeSafeClassifier` (LangChain integration; Python and TypeScript libraries) sends questions to Jev; types from `langchain_core.decisions`: Noul, Choice, Score, Box.
- Safety gate: one Choice with three outcomes `run` / `review` / `refuse` before each tool call; low confidence -> `review` (a person approves). "The LLM still plans, picks the tools, and writes the reply" - Jev only chooses the outcome. Also LangChain `AutoModeMiddleware` and human-in-the-loop middleware variants.
- Results on 24 labelled tool calls, 8 per outcome (vendor-run, jev-1.14.0 and gpt-5.5, 2026-11-24): Jev built-in middleware 24/24 agree with label, 8/24 run unattended, median time per decision 0.12 s; Jev custom middleware 24/24, 8/24, 0.06 s; name + amount rule 16/24, 11/24; name-based rule 14/24, 6/24. Tiny sample.

Other cookbooks listed in the index (not read in full): function_calling, skill_suggestion, classifying_rag_passages, hierarchical_classification, classification_using_confidence, rerank_typesafe (claims top-1 5% -> 30%, top-10 38% -> 65% on 40 CLERC queries), infinite_cardinality_choice, consistency_choice/noul, autoresearch_feature_discovery, and demos. Index at https://docs.typesafe.ai/llms.txt.

### A6. Latency, price, accuracy figures (all vendor claims)

- Latency: "Most calls complete in about 100 ms. Jev is fast enough for real-time request paths and user interfaces." (https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md). "Frontier intelligence in about 150ms" (https://docs.typesafe.ai/concepts/use-case-map.md). Launch post: end-to-end "70ms-500ms", "40x-200x faster" than frontier models listed at "3 to 329 seconds"; authors note evals "mostly run from a laptop on the West Coast" (https://typesafe.ai/blog/introducing-system-one-models-and-jev). Security-incidents eval: "a Jev workflow takes 0.3 seconds a case, against 3.4 to 66 seconds for the frontier models" (use-case-map; evals at https://evals.typesafe.ai/security_incidents, not fetched).
- Cloudflare's own benchmark run measured Jev median 524.1 ms, p95 536.0 ms (see B3), noticeably slower than TypeSafe's "about 100 ms". Different setups; note the gap.
- Price (https://docs.typesafe.ai/models.md): Jev 1.14 and Jev 1.13 both "$42 / $0.042" per Btok / Mtok; "You pay per input token. Output tokens are free." Cookbook cost: Jev checks "$0.04 per 1,000 tasks" in the cascade.
- Use-case map: "About 100x cheaper than a frontier LLM"; how-to page: "TypeSafe's target is a greater than 100x intelligence-to-speed-and-cost ratio"; launch post cites "193.6x faster, 444.6x cheaper" from the homepage (not on that page); authors say they can't prove the pricing isn't subsidized.
- Accuracy: use-case-map claims "Across the four evaluations, every model was more accurate as a structured workflow than with the same rules in one prompt" (https://docs.typesafe.ai/concepts/use-case-map.md). No headline accuracy number on the docs. Launch post says Jev "can't hallucinate" in the sense type errors are impossible, and calls that figure non-empirical; workflow evals use the average of GPT-6 Astra and Fable 5.1 as reference, which the authors say biases results toward those vendors.
- Context: Jev 1.14 and 1.13: "64k per-request / 32k per-question"; long-context header `TypeSafe-Danger-Zone-Long-Context: true` raises both to 262k tokens ("slower and less accurate than staying within the default limits"). No limit on question count, only request size. (https://docs.typesafe.ai/models.md)
- Launch post: choice cardinality supported up to 255; higher cardinalities use a two-stage process that "can cause occasional slowdowns" (launch post only).

### A7. SDKs, minimal code, availability, licensing

- SDKs: Python `typesafe-sdk` (`pip install typesafe-sdk`, `uv add typesafe-sdk`; async and sync clients; extras http2, pil, zstd; source https://github.com/typesafe-ai/typesafe-sdk-python) and JavaScript/TypeScript `@typesafe-ai/sdk` (Node.js 22+). Direct HTTP `POST https://api.typesafe.ai/v1/systemone`, `GET /v1/models`. API key `TYPESAFE_API_KEY` from https://console.typesafe.ai/. SDKs retry by default. (https://docs.typesafe.ai/sdk.md, https://docs.typesafe.ai/sdk/python.md, https://docs.typesafe.ai/introduction/quickstart.md)
- Minimal Python shape (from https://docs.typesafe.ai/primitives.md):
  ```python
  from typesafe_sdk import Choice, Noul, Score, TypeSafeClient
  with TypeSafeClient() as client:
      response = client.system_one(
          state={"ticket_message": "...", "refund_policy": "..."},
          questions={
              "refund_requested": Noul(instructions="Does `ticket_message` request a refund?"),
              "request_type": Choice(instructions="...", criteria={"refund": "...", "rebooking": "..."}),
              "frustration": Score(instructions="...", criteria=["Calm", "Concerned", "Very angry"]),
          },
      )
  response.answers["refund_requested"].noul
  response.answers["request_type"].choice
  response.answers["frustration"].score
  ```
- Minimal JS shape (quickstart): `client.systemOne({state, questions: {department: choice(...), frustration: score(...), is_urgent: noul(...)}})`, read `response.answers.department.choice`.
- Response includes `model` (versioned id) and `usage` (input_tokens, output_tokens).
- Models/aliases: `jev-1.14.0` (from October 14, 2026; adds Box, images, long-context), `jev-1.13.0`; alias `jev-latest` (default in SDK) and `jev-preview` (currently same model). Aliases move on release; pin the versioned id if you tuned thresholds. (https://docs.typesafe.ai/models.md, https://docs.typesafe.ai/changelog.md)
- Rate limits per organisation in the console; higher on custom/enterprise plans. Zero data retention (ZDR) for enterprise; "Jev is not trained on customer requests or responses"; not fine-tuned per customer ("the same weights serve every account"). (https://docs.typesafe.ai/models.md, https://docs.typesafe.ai/legal.md)
- Licensing: hosted API only; no open weights or self-host option found in the docs. Docs describe a free-ish playground at https://console.typesafe.ai/playground; no free-tier or plan pricing page found (only per-token price). Launch post says "early access" with a waitlist (status may have changed).
- Agent skill for coding agents: https://docs.typesafe.ai/agent-skill.md. "Jev is not a drop-in replacement for the LLM behind Claude Code, Cursor..." (https://docs.typesafe.ai/introduction/coding-agents.md)

### A8. When NOT to use System One (as TypeSafe says)

- https://docs.typesafe.ai/model-jaggedness.md ("Jev isn't perfect"). Opening: "It does the best on System One tasks. It may struggle with tasks that require additional levels of indirection. It can be quite literal... It struggles with tasks that require numeric precision." Failure modes and the "do this instead":
  1. Literal reading: write exact conditions.
  2. Math and numbers (counting, numeric representations, score interpolation): "Keep the arithmetic in code."
  3. Date/time comparison: extract components with Choice, compare in code.
  4. Indirection / multi-hop / double negatives: reduce hops.
  5. Large state full of irrelevant detail ("context rot"): filter first; or use a Noul to filter.
  6. Adversarial content: "State is data, and Jev does not treat it as hostile by default... text that argues for its own classification can move the answer."
  7. Contradictory instructions and criteria.
  8. Choice option order bias (leans to the first option): reorder to check.
  9. Generation: "Jev is not trained to generate text... If you really need to generate text... there are other models for that."
  - Reminder box: avoid asking the model something code can compute exactly; hiding several judgments in one question; "System Two tasks: more layers of indirections"; more state than needed.
- https://docs.typesafe.ai/primitives.md: broad "analyze and decide the best course of action" questions are the wrong shape; decompose.
- https://docs.typesafe.ai/introduction/coding-agents.md: not a chat or code-completion LLM; not for swapping the model behind a coding agent.
- https://docs.typesafe.ai/primitives/box.md: images and Box are "not yet up to our standards to call ready for production"; "can change between releases."
- https://docs.typesafe.ai/models.md: long context is slower and less accurate; calibration "does not guarantee that an individual answer is correct" (system-one.md).
- Dependent decisions: questions in one request cannot see each other; if a later judgment needs an earlier answer, make a second request (https://docs.typesafe.ai/primitives.md).
- Launch post (implicit, not a section): chatbots, copilots, coding agents, free-text generation, prototypes relying on flexible text.

---

## Part B. Cloudflare "Clef"

### B0. Result

A product named exactly **Clef** exists. It is Cloudflare's own family of open-weight decision models (a System One-style model family), launched 2026-10-01 on Workers AI. The voice-input spelling "Clef" was correct. No separate "Klef/Cleff/CLEF" product was found. Naming origin per Cloudflare: "In music theory, a clef is a symbol placed at the beginning of a musical staff... We chose Clef as the name of our family of decision models, as it serves similar purposes, and the CF hearkens to Cloudflare." (https://blog.cloudflare.com/clef-decision-models/)

### B1. What Cloudflare says Clef is

Primary sources:
- Launch blog (2026-10-01, Michelle Chen, Alex Reneau, Kevin Flansburg): https://blog.cloudflare.com/clef-decision-models/ - "Introducing Clef: Our open-source decision models, and new RL fine-tuning platform".
- Changelog (2026-10-01): https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/
- Model pages: https://developers.cloudflare.com/workers-ai/models/clef/ , https://developers.cloudflare.com/workers-ai/models/clef-flash/ , https://developers.cloudflare.com/workers-ai/models/clef-omni/
- Follow-up changelog 2026-10-09 (Clef-omni, price cut, speedup): https://developers.cloudflare.com/changelog/post/2026-10-09-clef-omni-workers-ai/ (content also in https://developers.cloudflare.com/changelog/product/workers-ai/)
- Pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/

Quotes:
- "A decision model makes classifications to help agents decide how to act, based on certain probabilities... A decision model will return typed answers with probabilities (outputs), which your code can use to route the ticket, trigger an escalation, or defer to a human. This means that a human does not necessarily need to be in the loop for agentic decisions anymore." (blog)
- Changelog: "Clef is a decision model, in the same family as Typesafe's Jev. Instead of generating text, it reads an input state and a set of typed questions, then returns a probability for every allowed answer... There is no free-form output to parse and no reasoning tokens to wait for."
- The blog opens by crediting Jev: "Jev introduces a new decision model concept into the world of AI". Cloudflare says Clef is "fully Jev-API compatible" and "follows the System One API, so you can switch an existing Jev integration to Clef by changing the endpoint and model."
- Pairing with LLMs (blog): "you could put Clef into the hot path for agents to make decisions and combine that with one of our LLMs on Workers AI to take action."
- Cloudflare's AI Platform post (https://blog.cloudflare.com/ai-platform/) describes the same multi-model idea without Clef: "Your customer support agent might use a fast, cheap model to classify a user's message; a large, reasoning model to plan its actions; and a lightweight model to execute individual tasks."

### B2. Models (as of 2026-11-28 per Cloudflare pages)

| Model id | Size | Context | Price (input only; output not charged) | Notes |
| - | - | - | - | - |
| `@cf/cloudflare/clef` | 27B | 64K (65,536) | $0.24 per M input tokens | Highest precision; vision encoder; zero data retention listed. Base: Qwen3.8-27B (blog). |
| `@cf/cloudflare/clef-flash` | 9B | 24K hosted (was 64K; weights support 256K self-hosted) | $0.038 per M input tokens (cut from $0.090 on 2026-10-09) | Latency-critical hot path. Base: Qwen3.5-9B. |
| `@cf/cloudflare/clef-omni` | 30B MoE, 3B active | 64K | $0.150 per M input tokens | Added 2026-10-09; takes audio (WAV/MP3) and video (MP4/WebM) plus text/images. |

- Questions: noul, choice, score; "Ask up to 64 questions per request" (changelog 2026-10-01); up to four images with the state.
- Also released: `@cf/cloudflare/clairic` (preview) "the first extraction model: a System One model that answers with values instead of text" (Workers AI changelog, https://developers.cloudflare.com/changelog/product/workers-ai/); `clairic-flash` appears in the model catalogue (https://developers.cloudflare.com/workers-ai/models/).
- Licence: weights open-sourced "under an Apache 2.0 license" on Hugging Face (https://huggingface.co/Cloudflare/clef , https://huggingface.co/Cloudflare/clef-flash). Secondary (The Register, snippet only, not read): reports the training datasets are not public.
- Access: Workers AI binding `env.AI.run("@cf/cloudflare/clef", {...})`, REST `/accounts/{id}/ai/run/@cf/cloudflare/clef`, and AI Gateway works with these endpoints.
- Minimal example (from the model page):
  ```js
  const response = await env.AI.run("@cf/cloudflare/clef", {
    model: "clef",
    state: "Checkout has been failing for every customer for the last hour.",
    questions: {
      urgent: { type: "noul", instructions: "Is this support request urgent?" },
      team: { type: "choice", instructions: "Which team should handle this request?",
              criteria: { billing: "...", technical: "...", sales: "..." } },
    },
  });
  // response.answers.urgent.noul ; response.answers.team.choice
  ```
- Data handling: "our guarantee that we don't read, store, or train on your requests or responses (unless you want to use our fine-tuning product)".

### B3. Architecture and figures (all Cloudflare vendor claims, Cloudflare-run benchmarks)

- Architecture (blog): Qwen backbone does "a prefill-only pass, then scores the valid schema choices in parallel. The decision step is non-autoregressive"; frozen Qwen plus a routing head and rank-256 low-rank adapters; label-smoothed cross-entropy plus Brier loss for calibration; "Reinforcement Learning for Calibrated Decisions (RLCD)" as a secondary objective (same name TypeSafe uses). Earlier experiment adapted DiffusionGemma.
- Latency across "43 eval benchmarks" (blog and changelog, same numbers): median / p95 ms: Clef 209.3 / 238.6; Clef-flash 38.8 / 122.4; Jev 524.1 / 536.0; DiffusionGemma Jev 84.4 / 211.2; Kev-9B 51.4 / 187.9; Laya 5.8 / 222.5. Changelog: "Clef is 2.5x faster than Jev at the median, and Clef-flash 13x faster."
- 2026-10-09 changelog: Clef "returns decisions up to 2x faster" after moving to SGLang: ~800 tokens 262/438 ms before vs 152/351 ms now (median/p95); ~3,400 tokens 616/777 vs 305/531; ~16,000 tokens 2,721/3,250 vs 1,635/1,805. Clef-omni: "Text requests: about 20 ms; Image or audio inputs: under 100 ms; A 21-second video clip with sound: about 300 ms."
- Benchmarks (blog, "Jev Decision Index"; table with Clef / Clef-flash / Jev / DiffusionGemma Jev / Kev 9B / Laya): BFCL case-exact 98.47 / 98.76 / 95.75; BANKING77 macro-F1 94.20 / 90.93 / 79.74; CLINC150+OOS 97.43 / 66.77 / 89.27; When2Call accuracy 72.37 / 65.58 / 80.97 (Jev wins); BRIGHT nDCG@10 45.91 / 39.26 / 47.52 (Jev wins). Changelog: "Across 10 decision benchmarks, a Clef model scores highest on 7."
- On TypeSafe's own workflow evals (blog): invoice processing Clef 64.7 / flash 57.1 / Jev 61.8; customer service 76.3 / 77 / 76.0; security incidents 62.9 / 61.7 / 61.7; agent trace observability 68.5 / 69.8 / 71.6 (Jev wins). "beating Jev in 3 out of 4 areas".
- Anecdote: threat-intel domain classification with Browser Run: Clef 2.2 s end to end vs `gpt-oss-120b` 4.7 s (and only two classifications).
- Context claim in blog: "a 64k context window (compared to Jev's 32k)". Note TypeSafe docs say 64k per-request / 32k per-question, so the comparison is per-question vs per-request; also Clef-flash hosted is now 24K.
- Differentiators Cloudflare claims over Jev: vision encoder (blog says "Jev... only does text classification today"; TypeSafe docs show Jev 1.14 does images and Box, so that blog line is out of date or imprecise), bigger context, edge GPU hosting, Apache 2.0 weights, lower Flash price ("cheaper than Jev").

### B4. How Cloudflare says to combine fast decision model + LLM

- Hot-path decide then act (blog, changelog): Clef in the request path, hand off to an LLM on Workers AI to act. Use cases listed: support triage, threat intelligence, trust and safety, "Agent guardrails: Let an agent check 'should I take this action?' in tens of milliseconds before calling a tool", visual classification.
- Fine-tuning ("new RL service", blog): hands-on with Cloudflare forward-deployed engineers first, later a self-serve platform. Stack: AI Gateway captures request datasets; Workers AI generates rollouts; Containers as RL sandbox; a new "Trainer"; redeploy via Workers AI bring-your-own-model. Design-partner signup https://www.cloudflare.com/resource/clef-rl-interest

### B5. Related Cloudflare routing features (candidates that are not Clef)

- AI Gateway Auto Router (public beta; blog dated 2026-09-30): https://blog.cloudflare.com/auto-router/ - set model to `cloudflare/auto`. Pipeline: filter eligible model pool; take recent messages; a "multi-head classification model running on Workers AI" assigns probabilities across 14 task categories and rates complexity, ambiguity, stakes and dependence on earlier context on 1 to 5; a scoring matrix combines these with model benchmark results; `utility = expected quality - adaptive cost penalty`; accounts for prompt-cache switching cost; returns ranked list with fallbacks. Vendor claims: "cost savings of up to 30% when compared to using only frontier models like OpenAI Sol and Anthropic Claude Opus" (internal OpenCode use); on an internal 97-task knowledge-work benchmark cloudflare/auto scored 86.6% at $2.10 total / $0.0084 per task vs ~84.2% to 96.6% for the two reference models at $2.64 and $5.91 (column labels in my text extraction were ambiguous, check the post), described as "80% the cost of Sol and 35% the cost of Opus". The classifier is not named as Clef in the post. Planned `cloudflare/auto-best` (quality only).
- AI Gateway dynamic routes: https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/ - visual/JSON flow with conditional (If/Else on request body, headers, metadata), percentage splits, rate-limit/budget nodes, model nodes with retries/timeouts, fallbacks; called as `dynamic/<route>`. Secondary summary only (search result), page body not read directly. These are rule-based routers; no model inside them in the docs I saw. Also model aliases: https://developers.cloudflare.com/ai-gateway/features/routing/model-aliases/.
- Workers AI small/fast general models exist in the catalogue (https://developers.cloudflare.com/workers-ai/models/): e.g. `llama-3.2-1b-instruct`, `llama-3.2-3b-instruct`, `llama-3.1-8b-instruct-fp8`, `granite-4.0-h-micro`, `glm-4.7-flash`, `deepseek-v4-flash-0731`. These are ordinary LLMs, not System 1 decision models.

---

## Part C. Other System-1-like offerings (as of November 2026)

### C1. Explicit decision / "System One" model vendors (a new category since Sept 2026)

Several vendors now ship typed-probability decision models, most with a Jev-shaped API (noul/choice/score or predicate/choice/score). Category date: TypeSafe Jev launch 2026-09-15 (launch post).

| Vendor / product | Primary source | Facts (vendor-stated unless noted) |
| - | - | - |
| OpenAI Decisions API | https://developers.openai.com/api/docs/guides/decisions.md | `POST /v1/decisions`; only supported model `gpt-6-luna`; types `predicate` (0..1), `choice` (probabilities + confidence), `score` (probability-weighted, 0-indexed levels + confidence); "about 10x faster than the Responses API"; "$0.10 per 1M tokens" uncached input, output not charged; 1 to 400 questions per request (beta was 200); GA; ZDR and HIPAA for eligible customers. Guidance: set thresholds from labelled examples; add a fallback choice like "other" and route to review; "For dependent decisions, send separate requests"; use Structured Outputs for schema-shaped or explanatory output and function calling for tool calls. GA date 2026-10-22 and "about 150 ms vs about 1.6 s" are from secondary sources (Unite.ai, CometAPI snippets), not verified on the guide. |
| Perplexity Decider / Decisions API | https://www.perplexity.ai/hub/blog/perplexity-decider (dated 2026-11-12) | Decider v1.3 (27B, "based on Qwen3.8-27B") and Decider Flash v1.3 (distilled, Qwen3.5-4B base); Apache licence; on Hugging Face, OpenRouter and the Decisions API; "inspired by Jev, TypeSafe AI's System One Model"; "91.6% mean accuracy" on 63 query-classification tasks (vendor claim); explicit routing use: "directing requests to smaller or larger models based on difficulty". Price $0.04 per M input is secondary only (search snippet). |
| Microsoft-Decision-1 (Foundry) | https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/introducing-microsoft-decision-1-in-microsoft-foundry-for-decision-and-classific/4562742 ; catalog https://ai.azure.com/catalog/models/Microsoft-Decision-1 | "built on Qwen3.5-9B"; $0.042 per 1M input tokens (US and EU Datazone), output N/A; public preview; "80-100 times faster" than GPT-5 on one Xbox Research task (vendor anecdote, sequential not production load); intended for "simple, repeatable, and time-sensitive decisions"; "A language model might draft a response, while Microsoft-Decision-1 evaluates it against defined criteria"; advises checking calibration on your own data before using confidence for automation. |
| Baseten elephant-1 (9B) / mammoth-1 (27B) | https://baseten.co/blog/the-best-decision-models-in-the-world-mammoth-1-and-elephant-1 | From Base Labs; Qwen3.5-9B/27B fine-tuned on 6.21M examples; "Compared to a reasoning model, a decision model may give up to a 10x speed up"; mammoth-1 71.24 on Jev Decision Index 0.4 "ranks #1 out of 208" (self-reported); free trial; ZDR default; use case "Routing requests between small and frontier LLMs"; example: auto-route at 90% confidence, else human. Licence stated MIT in a secondary source only. |
| Inception Mercury Decide | https://docs.inceptionlabs.ai/get-started/models | Endpoint `v1/decisions`; binary, categorical, ordinal and exact-span extraction; text/JSON/image; input $0.02 per M (regularly $0.04), output not charged; no chat, streaming or tool calling; no latency claim on the page. |
| Parallel Decisions API | https://parallel.ai/products/decisions | Web-grounded classification: searches the web per request, up to 100 questions sharing one search; "$1 per 1,000 requests"; "<1s" typical; answers include probability and citations. |
| Liquid AI d1-2B / d1-Omni-2B | https://www.liquid.ai/blog/lfm3 (2026-10-27) | On-device; many questions "in a single forward pass, each with a calibrated probability"; adds Point, Read, Estimate, Pick answer types; "decide in milliseconds" (no measured latency); open weights on Hugging Face. Other Liquid d1 variants (d1-ultra, d1.2) listed on liquid.ai/models, not read. |
| Cloudflare Clef family | see Part B | Open weights, Workers AI. |
| Others named in the Cloudflare benchmark table | https://blog.cloudflare.com/clef-decision-models/ | "Kev 9B", "Laya", "DiffusionGemma Jev": not investigated. Laya described as open-weights (Convai Innovations) in a secondary explainer, https://parallel.ai/learn/system-one-model (secondary; the page also lists JevBench, Artificial Analysis Decision Index, AIM System One Index leaderboards, figures not given). |

Vendors that explicitly use the phrase "System One": TypeSafe (coined/markets it), Cloudflare (calls Clairic "a System One model" and Clef "in the same family as Typesafe's Jev"; Clef "follows the System One API"), Perplexity ("Jev, TypeSafe AI's System One Model"). Others say "decision model". No vendor page found using "fast thinking".

Common guidance across vendors on combining with large models: decision model handles routing, classification, verification, guardrails and gating; LLM generates, plans, acts; thresholds on probabilities decide escalation to a person or larger model (TypeSafe A3/A5, Baseten, Microsoft, OpenAI, Perplexity, Cloudflare B4). All benchmarks cited above are vendor-run and mutually inconsistent in leaderboard ordering (each vendor tops its own comparison).

### C2. Small / fast general-purpose LLM tiers

- Anthropic Claude Haiku 5.5 - https://platform.claude.com/docs/en/models/haiku-5-5/overview : released October 7, 2026; ID `claude-haiku-5-5`; "For high-volume, latency-sensitive tasks such as classification, extraction, and routing"; comparative latency "Fastest" (relative within lineup); 1M context, 128K max output; input from $0.10 / MTok, output from $0.50 / MTok (prompts up to 100,000 tokens; $0.50 / $2.50 above); adaptive thinking on by default (effort default `medium`). Lineup and prices at https://platform.claude.com/docs/en/about-claude/models/overview : Fable 5.2 $8/$40, Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 from $0.10/$0.50. (Haiku 4.5 still listed at $1/$5.)
- OpenAI GPT-6 Luna - https://developers.openai.com/api/docs/models/gpt-6-luna : "Our most efficient model for focused, high-volume tasks"; `gpt-6-luna`; $0.10 / $0.50 per 1M input/output, $0.01 cached input; 1,050,000 context; reasoning effort none through max. Tiers from https://developers.openai.com/api/docs/models : Astra `gpt-6.2-astra` $8/$40, Sol `gpt-6.2-sol` $2/$10, Terra `gpt-6.1-terra` $1/$5 ("A fast, efficient model"), Luna `gpt-6-luna` $0.10/$0.50. Luna is the cheapest text tier listed; no "nano"/"mini" text model listed. Luna also powers the Decisions API.
- Google Gemini - model list https://aistudio.google.com/docs/models (redirect from ai.google.dev/gemini-api/docs/models): `gemini-3.5-flash-lite` "The fastest and most cost-effective 3.5 model, for high-throughput execution" (stable); `gemini-3.1-flash-lite` (stable); `gemini-3.8-flash` (stable); `gemini-3.6-flash` (stable). Pricing https://aistudio.google.com/docs/pricing : 3.5 Flash-Lite $0.30 input / $2.50 output (incl. thinking); 3.1 Flash-Lite $0.25 / $1.50 (audio $0.50 input); 3.8 Flash $0.75 / $3.75 through 2026-12-31 then $1.50 / $7.50. Page also recommends "Gemini 4 Hydrogen or Gemini 3.5 Flash-Lite" for new projects over 2.5 Flash-Lite (not investigated). No Google decision-model endpoint found on the pricing page (partially read, last 18k characters unread).
- Takeaway: all three big labs' small tiers are still generative LLMs with (adaptive) thinking, priced about $0.10 to $0.30 per M input; the decision-model products (OpenAI Decisions on Luna at $0.10 input with free output, TypeSafe $0.042, Cloudflare Clef-flash $0.038, Mercury Decide $0.02 promo) price input only.

### C3. Fast-inference hosts

- Groq - https://console.groq.com/docs/models : production models with listed speeds: `openai/gpt-oss-20b` ~1000 tokens/s ($0.075 in / $0.30 out); `openai/gpt-oss-120b` 500 tok/s ($0.15 / $0.60); `llama-3.1-8b-instant` 560 tok/s (price "contact sales" in the summary); `llama-3.3-70b-versatile` 280 tok/s. These are throughput figures from Groq's own page (vendor claims).
- Cerebras - https://inference-docs.cerebras.ai/models/overview : `gpt-oss-120b` ~3000 tokens/s; `qwen-3.8-27b` ~1850 tokens/s; no prices or status on that page.
- Not checked: first-party latency (time to first token) or benchmarks for either; whether either lists a decision-style endpoint (none seen).

### C4. Diffusion LLMs

- Inception Labs Mercury - https://docs.inceptionlabs.ai/get-started/models : Mercury 3 ("Our most intelligent model yet", 1M context, up to 131,072 output, reasoning effort `instant` to `high`; input $0.10 (regularly $0.20), output $0.35 (regularly $0.70), launch 50% off); Mercury 2.5 (previous-gen reasoning model for fast chat, agents, structured workflows; $0.20/$0.75); Mercury Voice ("A diffusion LLM tuned for voice agents", enterprise only); Mercury Edit 2; Mercury Decide (see C1); a "Mercury Router" card ("Match each request with the right Mercury model") with no details. The page makes no tokens-per-second claim, so no diffusion speed figure is verified here.
- Cloudflare's earlier decision-model experiment adapted DiffusionGemma (Google); the blog table lists "DiffusionGemma Jev" at 84.4 ms median (https://blog.cloudflare.com/clef-decision-models/). Not otherwise investigated.

### C5. Gaps / unverified

- TypeSafe: did not read the full text of primitive pages' code, remaining cookbooks, evals site (https://evals.typesafe.ai/), or pricing page beyond models.md; no explicit plan tiers found.
- Perplexity and OpenAI prices/latency partly from search snippets; Liquid d1 detail only the LFM3 post; Microsoft status per its blog (public preview) vs conflicting secondary reports.
- Secondary-only items: The Register (Cloudflare datasets not public), Sanity glossary (all TypeSafe figures not independently reproduced), tech-insider/other write-ups. Not relied on above except where labelled.
- Date oddities: TypeSafe launch post shows two dates (Sep 15 vs Nov 16, 2026). Cloudflare's "64k vs 32k" context comparison with Jev is not like-for-like.
