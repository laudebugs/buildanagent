# Fact-check: the Cloudflare voice pipeline example

This log checks the claims that `verify/cloudflare-agents/examples/12-voice-pipeline.ts`, its header comment and its README section make on 2026-11-22 (todo T47), against the pinned `agents` 0.33.0 (`dist/voice/index.d.ts`, `dist/voice/index.js`, `dist/types-_Faxb570.d.ts`), the mirrored voice doc at the `agents` release tag and the run itself.

Legend: ✅ confirmed · ✏️ corrected while drafting · ⚠️ unverified or our own inference.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| T47-1 | `withVoice(Agent)` adds speech-to-text, your `onTurn`, and text-to-speech to an Agent | ✅ | `dist/voice/index.d.ts`: "Voice pipeline mixin. Adds the full voice pipeline to an Agent class"; the subclass sets `transcriber` and `tts` and implements `onTurn` |
| T47-2 | `onTurn` may return an AI SDK `fullStream`, and the mixin speaks its text | ✅ | `agents/docs/agents/voice.md` "onTurn": "Streaming response (recommended for LLM)" ends with `return result.fullStream`; the run speaks the scripted reply |
| T47-3 | A `Transcriber` creates a session whose `feed(chunk)` receives audio and which calls `onInterim` and `onUtterance` | ✅ | `dist/types-_Faxb570.d.ts` `Transcriber`, `TranscriberSessionOptions` and `TranscriberSession`; the run delivers one interim and one final transcript from one frame |
| T47-4 | A `TTSProvider` is `synthesize(text, signal?)` returning `ArrayBuffer \| null` | ✅ | `dist/types-_Faxb570.d.ts` `TTSProvider` |
| T47-5 | The client messages `start_call`, `interrupt` and the server messages `welcome`, `status`, `audio_config`, `transcript_interim`, `transcript`, `turn_metrics` exist as the example uses them | ✅ | `VoiceClientMessage` and `VoiceServerMessage` in `dist/types-_Faxb570.d.ts`; the run receives each |
| T47-6 | The welcome carries protocol version 1, and `audio_config` reports `mp3` by default | ✅ | `dist/voice/index.js` sends `protocol_version: 1`, and `opt("audioFormat", "mp3")`; `VoiceAgentOptions.audioFormat` documents `@default "mp3"` |
| T47-7 | The tool runs inside the turn: after `onTurn` starts and before the reply is synthesized | ✅ | The first check compares the ordered log `onTurn`, `tool:Paris`, `tts:…`, written by the three call sites themselves |
| T47-8 | One audio frame follows the reply, and it holds the TTS provider's bytes | ✅ | `dist/voice/index.js` `_streamingTTSPipeline` sends each synthesized chunk with `connection.send`; the run compares the bytes |
| T47-9 | `turn_metrics` closes every allocated turn, with outcome `completed` or `aborted` and a `finalInputToFirstAudioMs` for a spoken turn | ✅ | `VoiceTurnMetrics` and `VoiceTurnOutcome` in the types file; `dist/diagnostics-C4jcz3VK.js` `finish()` sends `turn_metrics` for any outcome; the run shows both outcomes |
| T47-10 | An `interrupt` message aborts `context.signal`, aborts the signal the TTS call holds, runs `onInterrupt` and returns the status to `listening` | ✅ | `dist/voice/index.js` `_handleInterrupt` aborts the pipeline, sends `status: "listening"` and calls `onInterrupt`; `voice.md` says `signal` is "Aborted on interrupt or disconnect"; the run asserts each effect, and removing the `interrupt` send makes the check fail |
| T47-11 | The mixin keeps only `{ role, content }` text history, so a tool result reaches a later turn only if the agent stores it | ✅ | `VoiceTurnContext.messages` and `getConversationHistory()` are typed `{ role, content: string }`; `saveMessage` stores text; the run finds no tool message in turn 2's model request and a text-only history |
| T47-12 | `agents/voice` is experimental at 0.33.0, as of November 2026, and "will break between releases" | ✅ | `voice.md` line 26: "**Experimental.** This API is under active development and will break between releases. Pin your version."; 0.33.0 is the pin in `verify/cloudflare-agents/package.json` |
| T47-13 | Workers AI's speech models (Flux, Nova 3, text-to-speech) have no local simulation, so the speech stages are fakes | ⚠️ | Our harness's `AI` binding returns a canned answer ([harness README](../../../verify/cloudflare-agents/README.md#how-it-works)); we did not try the real models, so this states what the harness provides |
| T47-14 | workerd gives a client binary WebSocket messages as `Blob`s unless `binaryType` is `"arraybuffer"` | ⚠️ | Observed: without the line, the audio message failed an `instanceof ArrayBuffer` test and printed with an empty `type`, and with it the check passes; we did not read workerd's source |
| T47-15 | A released `agents` upgrade that breaks the API makes the weekly update pull request fail this example | ⚠️ | An inference from the todo's risk note and `sdk-updates.yml`'s per-harness verify result in AGENTS.md; not exercised |

**Totals:** 15 claims: 12 ✅, 0 ✏️, 3 ⚠️.
