# Latency, turn-taking, interruption and tool calls in spoken dialogue: what the research measures (as of November 2026)

Research notes, gathered 2026-11-19. Every source below was read on that date. Fetched pages are saved in the session scratchpad `u20/sources/`, and the list at the bottom maps each filename to its URL. arXiv papers are cited by the latest version shown in their submission history on that date, as arXiv `<id>vN`. Quotes from paper bodies come from the arXiv HTML rendering of that version. In that rendering, some numbers set in math mode drop out of the text, so a few figures below come from the abstract or a results table instead of the sentence around them.

Markers: **[paper]** a peer-reviewed or arXiv paper. **[docs]** official documentation. **[secondary]** blogs, vendor marketing, guides and search summaries. **Vendor result** marks a number a company measured on its own product. A benchmark run by academics on commercial APIs is not a vendor result, but it is a snapshot of whichever model version they tested.

Fetches that failed:
- PNAS page for Stivers et al. 2009 (HTTP 403). The same article was read on PubMed Central.
- ScienceDirect page for Skantze 2021 (captcha). Only the abstract was read, from the Semantic Scholar API. The review's body, including any specific silence-threshold figures, was not checked. The request for Elsevier's full-text API was refused in this session.

## 1. Human turn-taking timing: gaps of about 200 ms, production latency of 600 ms or more

### Takeaway
People begin replying about 200 ms after the other person stops. That gap is shorter than the time needed to plan even one word (600 ms or more) or a short sentence (about 1500 ms). Listeners must therefore predict where a turn will end and begin planning their reply while the other person is still talking. A system that waits for silence and only then starts thinking is already behind. A gap of 600 ms or more also carries social meaning: listeners hear it as signalling a dispreferred answer.

### Cited findings
- [paper] Stivers et al. 2009, PNAS 106(26), 10 languages: "The mean response offset for the full dataset is +208 ms, and the language-specific means fall within ≈250 ms either side of this cross-language mean". "Danish has the slowest response time on average (+469 ms) and Japanese has the fastest (+7 ms)." All languages show a "unimodal peak of response within 200 ms of the end of the question". "Speakers become hypersensitive to perturbations in timing of responses, measured in 100 ms or less." Responses "are often delayed by up to 1 s if, for example, they do not answer the question". — https://pmc.ncbi.nlm.nih.gov/articles/PMC2705608/ (DOI 10.1073/pnas.0903616106)
- [paper] Levinson & Torreira 2015, Frontiers in Psychology 6:731: "the gaps between turns are short (of the order of 200 ms), but the latencies involved in language production are much longer (over 600 ms). This seems to imply that participants in conversation must predict (or 'project' as SSJ have it) the end of the current speaker's turn in order to prepare their response in advance." — https://pmc.ncbi.nlm.nih.gov/articles/PMC4464110/ (also https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2015.00731/full)
- [paper] Levinson & Torreira 2015, production latencies: "The average reaction from seeing a picture to beginning the naming of has been estimated at 600 ms (Indefrey and Levelt, 2004 ...)". For simple scenes, "it takes about 1500 ms before speech output begins". The puzzle: "in spite of the long latencies involved in language production (600–1500 ms or more), participants often manage to achieve smooth turn transitions (with the most typical gaps as little as 100–300)." — same URL
- [paper] Levinson & Torreira 2015, why reacting to silence is too slow: "silence will only become recognizable as silence after c. 200 ms ... at which point it will still take a further minimally 200 ms to react (so 400 ms in total)." Social meaning of a long gap: "gaps of 600 ms or longer generate inferences of this unwelcome kind (Roberts et al., 2011)". — same URL
- [paper] Levinson & Torreira 2015, summarising Heldner & Edlund 2010: transition modes "at c. 200 ms (i.e., a short gap) and c. 60% of transitions being gaps, 40% overlaps". Their summary of Stivers gives means "between 7 and 468 ms". Stivers' own text says +469 ms for Danish; the two papers differ by 1 ms. — same URL
- [paper] Overlap is common: FDB v1.5 says overlap accounts "for over 40% of turns". — arXiv 2507.23159v4, https://arxiv.org/html/2507.23159v4

## 2. Full-duplex and end-to-end speech models compared with cascaded pipelines

### Takeaway
The literature draws three lines between architectures:
- **Cascaded or half-duplex:** VAD, then ASR, then a text LLM, then TTS, taking one turn at a time.
- **Engineered full-duplex:** modular parts plus a controller that decides when to speak or yield.
- **Learned full-duplex or end-to-end:** one model listens and speaks on parallel streams.

Moshi (Kyutai, 2024) is the reference end-to-end system, with a theoretical latency of 160 ms and 200 ms in practice. In 2025-2026, surveys stress that the label "full-duplex" covers very different capabilities. Many systems that claim it are "pseudo-full-duplex", meaning they switch between listening and speaking very quickly.

### Cited findings
- [paper] Moshi, arXiv 2410.00037v2 (2024-10-02): cascaded pipelines' "complexity induces a latency of several seconds between interactions"; "text being the intermediate modality for dialogue, non-linguistic information ... is lost"; "they rely on a segmentation into speaker turns, which does not take into account overlapping speech, interruptions and interjections." Moshi is "the first real-time full-duplex spoken large language model, with a theoretical latency of 160ms, 200ms in practice". — https://arxiv.org/abs/2410.00037
- [paper] Moshi, its two-stream design and "Inner Monologue": it models "separately its own speech and that of the user into parallel streams. This allows for the removal of explicit speaker turns". It is "full-duplex — it always listens and always generates sound, either speech or silence". Inner Monologue predicts "time-aligned text tokens as a prefix to audio tokens". Its Mimi codec runs "at 12.5Hz". "We pretrain Moshi with an acoustic delay of 2 and finetune it with an acoustic delay of 1, for a theoretical latency of 160ms." — https://arxiv.org/html/2410.00037v2
- [paper] Moshi on chain-of-modality designs, which generate text first and then speech: such a design "is fundamentally incompatible with live interactions as the model needs to produce an entire answer as text before it starts speaking." — https://arxiv.org/html/2410.00037v2
- [paper] dGSLM, arXiv 2203.16502v2 (2022-11-22): "the first 'textless' model able to generate audio samples of naturalistic spoken dialogues", using a "dual-tower transformer architecture with cross-attention trained on 2000 hours of two-channel raw conversational audio (Fisher dataset)". It "reproduces more naturalistic and fluid turn-taking compared to a text-based cascaded model". Moshi's assessment of it: "it remains a proof-of-concept: it does not run in an online fashion". — https://arxiv.org/abs/2203.16502; https://arxiv.org/html/2410.00037v2
- [paper] WavChat survey, arXiv 2411.13577v2 (2024-11-26): it categorizes systems "into the cascaded and end-to-end paradigms". The cascaded architecture "introduces several challenges, including high latency, limited interactivity, and the inability to process non-textual information." On full-duplex: "Unlike text-based models, it doesn't 'cover its ears' while speaking." — https://arxiv.org/html/2411.13577v2
- [paper] Chen & Yu survey, arXiv 2509.14515v1 (2025-09-18): "Current systems achieve only pseudo-full-duplex (PFD) behavior through time-division multiplexing". It sets up a "taxonomy distinguishing Engineered Synchronization (modular architectures) from Learned Synchronization (end-to-end architectures)". In the engineered approach, "The duplex controller—a neural FSM—extends beyond acoustic VAD to perform semantic arbitration, differentiating interruptions from backchannels and noise." — https://arxiv.org/html/2509.14515v1
- [paper] Lu et al. survey, arXiv 2606.19453v1 (2026-06-17): "More than a dozen spoken dialogue systems have recently claimed to be 'full-duplex,' yet the term has been used to describe substantially different capabilities." It proposes an "L0-L3 Architectural Hierarchy" and a "Decision State Machine (IDLE/LISTEN/SPEAK/WAIT/DUAL)", and reports a "realization gap". — https://arxiv.org/abs/2606.19453 (abstract only)
- [paper] Full-Duplex-Bench v1, arXiv 2503.04721v3 (2025-08-16; ASRU 2025): "While cascaded approaches offer flexibility and stronger semantic modeling, they often suffer from cross-module latency and the loss of nuanced speech features". — https://arxiv.org/html/2503.04721v3

## 3. End-of-turn detection: silence thresholds compared with prediction

### Takeaway
Most deployed agents end the user's turn after a fixed period of silence. That forces a trade-off. A short threshold makes the agent cut people off when they pause. A long threshold makes it slow: one study's 1 s silence threshold produced a typical response time of about 2.6 s. Predictive models avoid the trade-off. Voice Activity Projection (VAP) and TurnGPT do this in research, and LiveKit's turn detector and Pipecat Smart Turn do it in production. In one user study, these models reduced both response delay and interruptions.

### Cited findings
- [paper] Skantze 2021, "Turn-taking in Conversational Systems and Human-Robot Interaction: A Review", Computer Speech & Language 67, DOI 10.1016/j.csl.2020.101178 (CC BY). Abstract only: "Humans are very good at this coordination, and typically achieve fluent turn-taking with very small gaps and little overlap. Conversational systems ... typically have problems with frequent interruptions and long response delays". The review covers "end-of-turn detection, handling of user interruptions, generation of turn-taking cues". — https://doi.org/10.1016/j.csl.2020.101178 (body not fetched; abstract read through https://api.semanticscholar.org/graph/v1/paper/DOI:10.1016/j.csl.2020.101178). No figure for a common silence threshold was confirmed from the review itself.
- [paper] Voice Activity Projection, Ekstedt & Skantze, arXiv 2205.09812v1 (2022-05-19; submitted to Interspeech 2022): turn-taking is modelled as "the dynamics of voice activity of the interlocutors", with "a general, self-supervised objective, as a way to train turn-taking models without the need of labeled data". The authors report zero-shot tasks "related to the prediction of upcoming turn-shifts and backchannels". — https://arxiv.org/abs/2205.09812
- [paper] Applying VAP and TurnGPT in a robot study, arXiv 2501.08946v1 (2025-01-15; HRI 2025). Silence-based systems: "since silence alone is not a reliable indicator that a user is yielding the turn (they may simply pause mid-sentence), this approach often results in either long response delays or frequent interruptions, depending on the set silence threshold". The baseline's response-time peak "at 2.6 s ... is close to the expected response time, given a silence threshold of 1 s, LLM response time of 0.5 s, and a TTS delay of 1 s." Results with 39 participants, proposed system against baseline: median response time "1.5 s vs 2.7 s"; interruption rate 6.9% against 16.6%. A practical constraint: "it is not enough to have a turn-taking model that can determine when the robot is allowed to speak, it must also have something ready to say". — https://arxiv.org/html/2501.08946v1
- [paper] Full-Duplex-Bench v1 used CANDOR pauses of "between 0.4 and 1.0 seconds", because "pauses of around one second are perceived as a natural upper bound in English conversation". Smooth transitions "typically occur within 200–250 milliseconds". — https://arxiv.org/html/2503.04721v3
- [docs, vendor] LiveKit turn detector docs: "a user might say 'I need to think about that for a moment' and then take a long pause. The user has more to say but a VAD-only system interrupts them anyway." "By default, the session waits between 0.5 and 3.0 seconds after speech to confirm the end of a turn." With the audio turn detector, the defaults become min_delay 0.3 s and max_delay 2.5 s. The deprecated text turn detector, which runs on Qwen2.5-0.5B-Instruct, has a "Per Turn Latency ~50-160 ms". English true-positive rate is 99.3% and true-negative rate 87.0% (vendor result). — https://docs.livekit.io/agents/logic/turns/turn-detector/
- [secondary, vendor] LiveKit blog, 2024-12-20: "The default value for min_endpointing_delay is 500ms". "If you increase the threshold to a second or two, your agent will feel unresponsive." For its 135M end-of-utterance model with VAD, LiveKit reports that it "Reduces unintentional interruptions by 85%" and "Falsely indicates that the turn is not over 3% of the time" (vendor result). — https://livekit.com/blog/using-a-transformer-to-improve-end-of-turn-detection
- [docs, vendor] Pipecat Smart Turn v3.2 README: "Most voice agents today use voice activity detection (VAD) as the basis for turn detection. ... VAD can't take into account the actual linguistic or acoustic content of the speech." The model "uses Whisper Tiny as a base, with a linear classifier layer" and has "approximately 8M parameters". It "Runs in as little as 10ms on some CPUs, and under 100ms on most cloud instances", with "inference completing in around 65ms" on Pipecat Cloud (vendor result). — https://github.com/pipecat-ai/smart-turn

## 4. Interruption (barge-in), backchannels and overlap: measured behaviour of real systems

### Takeaway
The Full-Duplex-Bench series (National Taiwan University and others) is the main open measurement of these behaviours. It gives three results:
- **v1:** end-to-end models (Moshi, dGSLM) answer fast (about 0.26-0.35 s) but take the floor during pauses almost every time and give poor replies after an interruption. The Gemini Live version tested rarely takes the floor during pauses but answers more slowly (about 1.2-1.3 s).
- **v1.5:** commercial APIs split into two strategies. gpt-4o-realtime yields fast, stopping in about 0.2 s, but also yields to backchannels, side conversations and background speech. Gemini Live and Nova Sonic hold the floor and take 2.2 s or more to yield to a real interruption.
- **v2 (multi-turn):** systems "get confused when people talk at the same time".

No tested system handles both true interruptions and filtering well. All of these numbers apply only to the model versions tested, which were 2024-2025 releases.

### Cited findings
- [paper] Full-Duplex-Bench v1, arXiv 2503.04721v3 (2025-08-16): it evaluates "pause handling, backchanneling, turn-taking, and interruption management", using Takeover Rate (TOR), backchannel JSD and latency. Table III results:
  - **Pause handling, TOR (synthetic / Candor):** dGSLM 0.934/0.935, Moshi 0.985/0.980, Freeze-Omni 0.642/0.481, Gemini Live 0.255/0.310. Lower is better.
  - **Smooth turn-taking latency:** dGSLM 0.352 s, Moshi 0.265 s, Freeze-Omni 0.953 s, Gemini Live 1.301 s. Gemini Live's TOR on this task was 0.655: "even commercial models sometimes fail to take the turn".
  - **User interruption latency:** dGSLM 2.531 s, Moshi 0.257 s, Freeze-Omni 1.409 s, Gemini Live 1.183 s.
  - **Reply quality after interruption (GPT-4o score, 0-5):** dGSLM 0.201, Moshi 0.765, Freeze-Omni 3.615, Gemini Live 3.376.

  Gemini Live here is `gemini-2.0-flash-live-001` with server-side VAD. — https://arxiv.org/html/2503.04721v3
- [paper] Full-Duplex-Bench v1, interpretation: "The end-to-end models (dGSLM and Moshi) tend to interrupt more often". "An explicit turn-taking control module can better manage pauses". "These results highlight the challenges end-to-end systems face in preserving semantic coherence during user interruptions." — same
- [paper] Full-Duplex-Bench v1.5, arXiv 2507.23159v4 (2026-04-26; ICASSP 2026). It defines four overlap scenarios: "user interruption, user backchannel, talking to others, and background speech". "Stop latency is the interval from the onset of overlapping user speech to the moment the model stops speaking". Response latency runs "from the end of the overlapping speech to the model's next utterance". Models tested: Freeze-Omni, Moshi, `gemini-2.0-flash-live-001`, `amazon.nova-sonic-v1:0` and `gpt-4o-realtime-preview-2024-12-17`. — https://arxiv.org/html/2507.23159v4
- [paper] FDB v1.5, Table 2, results for user interruption:

  | Model | Respond rate | Resume rate | Stop latency | Response latency |
  |---|---|---|---|---|
  | Freeze-Omni | 0.72 | 0.12 | 1.42 s | 1.35 s |
  | Moshi | 0.50 | 0.26 | 1.16 s | 1.47 s |
  | Gemini | 0.33 | 0.55 | 2.20 s | 2.62 s |
  | Sonic | 0.24 | 0.71 | 2.25 s | 2.75 s |
  | GPT-4o | 0.78 | 0.10 | 0.23 s | 1.50 s |

  "Resume" means the model continued its earlier turn. — same
- [paper] FDB v1.5, filtering results, where the right behaviour is to continue speaking ("Resume"):
  - **Backchannel:** Resume Sonic 0.98, Gemini 0.93, GPT-4o 0.70, Moshi 0.06. GPT-4o's stop latency here was 0.21 s; the authors call it "highly sensitive ... suggesting over-eager halting even for short cues".
  - **Talking to others:** GPT-4o "treats most non-addressee speech as new intent (Respond=0.91)", while Gemini scored Resume 0.99.
  - **Background speech:** GPT-4o Respond 0.93, Sonic Resume 0.98.
  - **Conclusion:** "fast yielders excel on true interruptions but over-accommodate incidental speech, while robust holders resist non-addressed input yet delay necessary repairs." Sonic and Gemini "leave long gaps (2.0–2.7 s)". — same
- [paper] Full-Duplex-Bench v2, arXiv 2510.07838v2 (2026-04-26; ACL 2026): multi-turn, with an automated examiner and "two pacing setups (Fast vs. Slow)". Full-duplex systems "often get confused when people talk at the same time, struggle to handle corrections smoothly, and sometimes lose track of who or what is being talked about." — https://arxiv.org/abs/2510.07838 (abstract only; per-model numbers not extracted)
- [paper] MTR-DuplexBench, arXiv 2511.10262v3 (2026-04-17; Findings of ACL 2026): "current FD-SLMs face difficulties in maintaining consistent performance across multiple rounds and evaluation dimensions". — https://arxiv.org/abs/2511.10262 (abstract only)
- [paper] τ-Voice, arXiv 2603.13686v1 (2026-03-14; ICML 2026), testing `gpt-realtime-1.5`, `gemini-live-2.5-flash-native-audio` and `grok-voice-agent`. "OpenAI achieves fastest latency (0.90s) and near-perfect responsiveness (100%) but worst selectivity (6%); xAI leads slightly in task completion (51% Clean, 38% Realistic) but has the highest interrupt rate (84%). No provider masters both task completion and conversational dynamics." Yield Rate is the "proportion of interruptions where agent yields within 2s". — https://arxiv.org/html/2603.13686v1

## 5. Tool calls during spoken dialogue

### Takeaway
Voice agents complete tool-using tasks much less often than text agents given the same tasks. τ-Voice found voice agents keep 30-45% of text capability. The newest benchmarks measure what is specific to voice:
- tool calls fired before the user has finished speaking;
- filler speech ("let me check on that") that hides latency but talks over users;
- mid-sentence self-corrections, which require rolling back arguments already filled in;
- an agent that calls the tool but never speaks the answer.

In FDB-v3 (April 2026), the cascaded baseline was slowest (10.12 s to the answer) and worst on self-corrections (0.176 Pass@1), because the transcript was final before the correction arrived. In VoiceAgentBench (synthetic speech, single- and multi-tool tasks), ASR-plus-LLM pipelines outperformed end-to-end speech LMs. Which architecture wins on accuracy therefore depends on the benchmark. Research prototypes (SHANKS, Stream RAG) start reasoning and tool calls while the user is still talking.

### Cited findings
- [paper] Full-Duplex-Bench-v3, arXiv 2604.04847v1 (2026-04-06; "Work in progress"): it uses "real human audio annotated for five disfluency categories" with "chained API calls across four task domains". Its mock APIs return "deterministic, zero-latency responses". All six systems were "deployed through the LiveKit Realtime Voice Agent framework". The cascaded baseline was "OpenAI Whisper for speech recognition, GPT-4o for reasoning and tool use, and OpenAI TTS". — https://arxiv.org/html/2604.04847v1
- [paper] FDB-v3, Table 2:

  | Model | Pass@1 | Turn-take rate | Task-completion latency | Interrupt rate | Filler rate |
  |---|---|---|---|---|---|
  | GPT-Realtime | 0.600 | 96.0% | 6.89 s | 13.5% | 16.9% |
  | Gemini Live 2.5 | 0.490 | 92.0% | 7.26 s | 14.1% | 8.9% |
  | Gemini Live 3.1 | 0.540 | 78.0% | 4.25 s | 19.2% | 31.7% |
  | Grok | 0.430 | 94.0% | 6.65 s | 25.5% | 44.3% |
  | Ultravox | 0.410 | 96.0% | 8.40 s | 47.9% | 88.0% |
  | Cascaded | 0.450 | 100.0% | 10.12 s | 33.0% | 26.9% |

  GPT-Realtime links to the gpt-realtime-1.5 model page. — same
- [paper] FDB-v3, latency breakdown: Gemini Live 3.1 is "fastest on all three (3.95 s / 2.21 s / 4.25 s)", for first word, tool call and task completion. Ultravox's "first-word latency (3.88 s) is among the fastest, yet its tool-call latency (6.01 s) is the slowest—the model speaks before it calls any tool", and "filler speech frequently overlaps with the user's utterance (47.9% interruption rate)". The cascaded system's "first-word delay (8.78 s)" dominates its latency. — same
- [paper] FDB-v3, pre-emptive tool calls, defined as "one invoked before the user finishes speaking": "Grok 41.6%, Ultravox 23.2%, Gemini Live 2.5 17.9%, Gemini Live 3.1 16.9%, GPT-Realtime 10.8%". "Pre-emptive tool-call rates do not predict interruption rates." — same
- [paper] FDB-v3, self-correction: "Even GPT-Realtime, the leader at 0.588, fails on over 40% of self-correction scenarios"; Cascaded scores 0.176. "Because Whisper may finalize the original (incorrect) transcription before the user's correction arrives, the downstream LLM has no opportunity for state rollback." "Silent worker": Gemini Live 3.1 "produces no speech in 22% examples", and "86% silent cases still executed tool calls". — same
- [paper] FDB-v3 on cascaded against end-to-end: "Although it shares the same underlying LLM as GPT-Realtime, its Pass@1 is markedly lower (0.450 vs. 0.600), indicating that ASR-introduced errors propagate downstream." This baseline is one particular cascade (Whisper, GPT-4o and OpenAI TTS through LiveKit). It is not a tuned streaming cascade, so its 10 s latency should not be read as the floor for cascaded systems. — same
- [paper] τ-Voice, arXiv 2603.13686v1: 278 tasks extending τ²-bench. "while GPT-5 (reasoning) achieves 85%, voice agents reach only 31--51% under clean conditions and 26--38% under realistic conditions with noise and diverse accents--retaining only 30--45% of text capability"; "79--90% of failures stem from agent behavior". — https://arxiv.org/abs/2603.13686
- [paper] VoiceAgentBench, arXiv 2510.07978v3 (2026-02-13): "6,000+ synthetic spoken queries spanning single-tool invocations, multi-tool workflows, multi-turn dialogue, and safety evaluations across English and six Indic languages". "ASR-LLM pipelines outperform end-to-end SpeechLMs, achieving up to 60.6% average parameter-filling accuracy on English". "All models struggle in sequential workflows and safety evaluations". — https://arxiv.org/abs/2510.07978
- [paper] From Text to Voice, arXiv 2605.15104v3 (2026-10-21; TMLR). Tested on audio versions of Confetti and When2Call: "Gemini-3.1-Flash-Live obtains the highest Confetti score (70.4), whereas GPT-Realtime-1.5 performs best on When2Call (71.9). On Confetti, the text-to-voice gap ranges from 1.8 points for Qwen3-Omni to 4.8 points for GPT-Realtime-1.5." "degradations most often reflect misunderstandings of argument values in the speech". — https://arxiv.org/abs/2605.15104
- [paper] Audio2Tool, arXiv 2604.22821v2 (2026-04-28): "approximately 30,000 queries" across Smart Car, Smart Home and Wearables; "strong performance on simple commands but significant degradation under compositional and acoustic challenges". — https://arxiv.org/abs/2604.22821
- [paper] Stream RAG (Meta and CMU), arXiv 2510.02044v1 (2025-10-02): "tool integration substantially increases response latency, disrupting conversational flow". The method predicts "tool queries in parallel with user speech, even before the user finishes speaking". It "increases QA accuracy by up to 200% relative (from 11.1% to 34.2% absolute)" and reduces "tool use latency by 20%". A search summary gave different figures (20.7% and 53.4%); those were not checked against the body. — https://arxiv.org/abs/2510.02044
- [paper] SHANKS, arXiv 2510.06917v2 (2025-10-18; "Work in progress"; a search summary lists it at ACL 2026, not checked): "Current large language models (LLMs) and spoken language models (SLMs) begin thinking and taking actions only after the user has finished their turn." SHANKS generates "unspoken chain-of-thought reasoning while listening". It achieves "37.1% higher interruption accuracy than a baseline that interrupts without thinking", and "can complete 56.9% of the tool calls before the user finishes their turn". — https://arxiv.org/abs/2510.06917
- [secondary, vendor] Voice AI & Voice Agents primer (lead author Kwindla Hultman Kramer, Pipecat; "This update was published in June 2026"). "Function calls add latency — potentially a lot of latency — for four reasons": two inference calls instead of one; "The function call request can't be streamed"; "some APIs, at least some of the time, have higher median TTFTs when tool use is enabled"; and slow back ends. Its worked example: with "LLM TTFT is 450ms" and 100 tokens per second, a 100-token call gives "TTFT for the full inference is 1,450ms". It recommends speaking before the call or setting "a watchdog timer". It also advises: "You need to stop your voice-to-voice inference loop until all function calls complete", and that for asynchronous calls "you need to start the async task and then immediately return a basic started task successfully response". It warns that "current-generation LLMs struggle with voice AI use cases even when they do well on general function calling benchmarks." — https://voiceaiandvoiceagents.com/

## 6. Latency budgets for cascaded pipelines

### Takeaway
No peer-reviewed per-stage budget for a streaming STT-LLM-TTS agent was found. The most detailed breakdown comes from a vendor guide by Pipecat. It targets 1,500 ms voice-to-voice, gives a typical total of about 1,293 ms, and names the LLM's time to first token as the largest single stage. Research papers give rougher figures: a cascade with a 1 s silence threshold responded in about 2.6 s, and FDB-v3's cascade took 8.78 s to its first word.

### Cited findings
- [secondary, vendor] Pipecat primer: "A response time of 500ms is typical. Long pauses feel unnatural." Server-side latency figures miss things: "this server-side view does not account for audio processing, phrase endpointing delay, network transport, and operating system overhead." Its target: "1,500 ms voice-to-voice latency is an important target to aim for." Its typical breakdown, in ms: macOS mic input 40, opus encoding 21, network 10, packet handling 2, jitter buffer 40, opus decoding 1, "transcription and endpointing 300", "llm ttfb 650", sentence aggregation 20, "tts ttfb 120", then the return path (21, 2, 10, 40, 1) and speaker output 15, for "Total ms 1293". It also claims "voice-to-voice latency as low as 500 ms, by hosting all models within the same GPU-enabled cluster" (vendor result). — https://voiceaiandvoiceagents.com/
- [paper] Robot-study baseline: "silence threshold of 1 s, LLM response time of 0.5 s, and a TTS delay of 1 s" gave a peak response time of about 2.6 s. — https://arxiv.org/html/2501.08946v1
- [paper] Moshi says cascades produce "a typical global latency of several seconds. This is unlike natural conversations which demonstrate response times of a few hundred milliseconds." — https://arxiv.org/html/2410.00037v2
- [paper] FDB-v3's cascade: first word at 8.78 s and the answer at 10.12 s, against 3.95 s and 4.25 s for Gemini Live 3.1. Its "sequential Whisper LLM TTS chain creates an irreducible bottleneck". — https://arxiv.org/html/2604.04847v1
- [docs, vendor] Endpointing alone adds 0.3-0.5 s minimum under LiveKit's defaults, up to a 2.5-3.0 s maximum (see section 3). Smart Turn adds about 10-100 ms of inference. — https://docs.livekit.io/agents/logic/turns/turn-detector/; https://github.com/pipecat-ai/smart-turn

## 7. Echo and self-interruption: why echo cancellation matters for barge-in

### Takeaway
An agent that listens while it speaks, which barge-in requires, hears its own voice through the user's speaker and microphone. Without acoustic echo cancellation (AEC), it treats that sound as the user interrupting and cuts itself off. AEC has to run on the device, because it is latency-sensitive. Browsers, WebRTC SDKs and telephony stacks provide it. Research systems either train with simulated echo (Moshi) or avoid the problem with headsets (the robot study). No dedicated paper on AEC for LLM voice agents was found. The sources below are a vendor guide, two research papers that mention echo in passing, and MDN.

### Cited findings
- [secondary, vendor] Pipecat primer: "if a user is talking on a speakerphone, or using a laptop without headphones, then good echo cancellation is extremely important. Echo cancellation is very sensitive to latency, so echo cancellation has to run on the device (not in the cloud). Today, excellent echo cancellation is built into telephony stacks, web browsers, and WebRTC native mobile SDKs." On self-interruption: "you've probably heard your bot interrupt itself right when it starts talking. The culprit is echo cancellation allowing a little bit of the initial speech audio to feed back into your microphone. The minimum VAD start segment length helps to avoid this problem." — https://voiceaiandvoiceagents.com/
- [paper] Moshi training: "We emulate echo from Moshi into the user's microphone by adding a scaled down copy of Moshi's stream into the user's stream". "The echo and reverb are applied together with a probability of 30%." — https://arxiv.org/html/2410.00037v2
- [paper] Robot study: "To avoid the need for echo cancellation and to get a clear recording, a headset with a close-talking microphone was used for interaction". The same paper notes that silence-based systems "avoid processing user input while the system is speaking". — https://arxiv.org/html/2501.08946v1
- [docs] MDN, MediaTrackConstraints: `echoCancellation` is "A ConstrainBooleanOrDOMString object specifying whether or not echo cancellation is preferred and/or required, and if supported, what type." — https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints
- [docs, vendor] LiveKit names a related failure: "the framework detects human speech audio and interrupts the agent, but the transcription comes up empty as no actual words are spoken. In these cases, the VAD-based interruption is considered a false positive. By default, the agent resumes speaking from where it left off after a false interruption." Its "Adaptive interruption handling can distinguish true interruptions from conversational backchanneling." — https://docs.livekit.io/agents/logic/turns/

## What this means for the report (my synthesis, not a source claim)

1. The voice loop runs against a clock that a text loop never faces. Humans leave about 200 ms between turns and read 600 ms or more as meaningful, while measured agents take about 0.9 s at the fastest (τ-Voice) to 4-10 s on tool tasks (FDB-v3). Latency is a correctness property in voice, not only a speed concern.
2. "When is the user done?" is a model decision with a false-positive/false-negative trade-off, not a fixed silence timeout. The report should treat turn detection (VAD, semantic or audio end-of-turn models, server VAD) as a separate, configurable layer of the loop.
3. Barge-in breaks text-agent assumptions. Output must be cancellable mid-stream, the context must record what was actually heard, and the system must tell real interruptions from backchannels, side talk and its own echo. Benchmarks show every commercial API picks a point on that trade-off, and none handles both sides well.
4. Tool calls hurt more in voice. A call costs an extra round trip and cannot be streamed, filler speech hides the wait but causes interruptions, and corrections made mid-sentence require rolling back arguments. Starting reasoning and tool calls before the user finishes (pre-emptive calls, SHANKS, Stream RAG) is the research direction, and it matches SDK features such as asynchronous or non-blocking tools.
5. Cascaded and end-to-end is not a simple win for either. End-to-end systems are faster and better at self-correction in FDB-v3. Cascades win on accuracy in VoiceAgentBench, and engineered controllers beat pure end-to-end models on pause handling in FDB v1. The report should tie each SDK's architecture to these measured trade-offs, and should date every benchmark number by model version, because these numbers change with each release.

## Saved sources (filename -> URL)

Directory: the session scratchpad `u20/sources/`

- pmc-stivers-2009.html -> https://pmc.ncbi.nlm.nih.gov/articles/PMC2705608/
- pmc-levinson-torreira-2015.html -> https://pmc.ncbi.nlm.nih.gov/articles/PMC4464110/
- frontiers-levinson-torreira-2015.html -> https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2015.00731/full
- semanticscholar-skantze-2021.json -> https://api.semanticscholar.org/graph/v1/paper/DOI:10.1016/j.csl.2020.101178?fields=title,abstract,year,venue,openAccessPdf,externalIds
- crossref-skantze-2021.json -> https://api.crossref.org/works/10.1016/j.csl.2020.101178
- arxiv-2410.00037-abs.html -> https://arxiv.org/abs/2410.00037
- arxiv-2410.00037v2-html.html -> https://arxiv.org/html/2410.00037v2
- arxiv-2203.16502-abs.html -> https://arxiv.org/abs/2203.16502
- arxiv-2411.13577-abs.html -> https://arxiv.org/abs/2411.13577
- arxiv-2411.13577v2-html.html -> https://arxiv.org/html/2411.13577v2
- arxiv-2509.14515-abs.html -> https://arxiv.org/abs/2509.14515
- arxiv-2509.14515v1-html.html -> https://arxiv.org/html/2509.14515v1
- arxiv-2606.19453-abs.html -> https://arxiv.org/abs/2606.19453
- arxiv-2205.09812-abs.html -> https://arxiv.org/abs/2205.09812
- arxiv-2501.08946-abs.html -> https://arxiv.org/abs/2501.08946
- arxiv-2501.08946v1-html.html -> https://arxiv.org/html/2501.08946v1
- arxiv-2503.04721-abs.html -> https://arxiv.org/abs/2503.04721
- arxiv-2503.04721v3-html.html -> https://arxiv.org/html/2503.04721v3
- arxiv-2507.23159-abs.html -> https://arxiv.org/abs/2507.23159
- arxiv-2507.23159v4-html.html -> https://arxiv.org/html/2507.23159v4
- arxiv-2510.07838-abs.html -> https://arxiv.org/abs/2510.07838
- arxiv-2511.10262-abs.html -> https://arxiv.org/abs/2511.10262
- arxiv-2603.13686-abs.html -> https://arxiv.org/abs/2603.13686
- arxiv-2603.13686v1-html.html -> https://arxiv.org/html/2603.13686v1
- arxiv-2604.04847-abs.html -> https://arxiv.org/abs/2604.04847
- arxiv-2604.04847v1-html.html -> https://arxiv.org/html/2604.04847v1
- arxiv-2510.07978-abs.html -> https://arxiv.org/abs/2510.07978
- arxiv-2510.07978v3-html.html -> https://arxiv.org/html/2510.07978v3
- arxiv-2605.15104-abs.html -> https://arxiv.org/abs/2605.15104
- arxiv-2604.22821-abs.html -> https://arxiv.org/abs/2604.22821
- arxiv-2510.02044-abs.html -> https://arxiv.org/abs/2510.02044
- arxiv-2510.06917-abs.html -> https://arxiv.org/abs/2510.06917
- livekit-docs-turn-detector.html -> https://docs.livekit.io/agents/build/turns/turn-detector/ (redirected to https://docs.livekit.io/agents/logic/turns/turn-detector/)
- livekit-docs-turns.html -> https://docs.livekit.io/agents/build/turns/ (redirected to https://docs.livekit.io/agents/logic/turns/)
- livekit-blog-turn-detection.html -> https://blog.livekit.io/using-a-transformer-to-improve-end-of-turn-detection/ (redirected to https://livekit.com/blog/using-a-transformer-to-improve-end-of-turn-detection)
- pipecat-smart-turn-github.html -> https://github.com/pipecat-ai/smart-turn
- voiceaiandvoiceagents-guide.html -> https://voiceaiandvoiceagents.com/
- mdn-mediatrackconstraints.html -> https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints

Plain-text extracts used for grepping, made from the HTML above, are in the sibling folder `.../scratchpad/u20/txt/`.
