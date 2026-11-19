# Vendor realtime voice APIs and transport specs (as of November 2026)

Research notes, gathered 2026-11-19 from official vendor docs (OpenAI, Google Gemini, Anthropic, Cloudflare) and from IETF and W3C specifications. Every page cited was fetched that day with `curl` (generic User-Agent) and saved under the session scratchpad at the session scratchpad `u20/sources/`. Where a site offered Markdown (OpenAI and Cloudflare: append `.md`; Gemini: `aistudio.google.com/docs/*.md`; Anthropic: `platform.claude.com/docs/*.md`), that variant was saved. HTML pages were also saved as `.txt` with tags stripped, so the fact-checker can grep them. The file-to-URL map is at the bottom. Model names, prices, limits and statuses are as of November 2026. These docs change often.

**Markers.** **[docs]** = official vendor documentation (API docs, model pages, pricing pages, official help centre). **[spec]** = an IETF RFC or a W3C specification. **[secondary]** = anything else. Nothing in this file is [secondary]: no search summaries or third-party blogs were used. Quotes are verbatim. `...` marks an elision. Many source files (the RFCs, the Gemini pages, the OpenAI reference pages) hard-wrap their lines, so collapse whitespace before grepping (for example `tr -s ' \n' '  ' < file | grep -F "..."`). Markdown link targets inside quotes are shown as `[text]`.

**Scope.** This file covers vendor realtime and voice APIs and the transport specs beneath them. Papers on latency and turn-taking, and SDK typings, are covered in other notes files.

**Note on OpenAI pages.** Many OpenAI voice pages hold two variants selected by `?api=live` and `?api=realtime`, and the `.md` download contains both. Quotes below come from the Realtime variant unless marked "GPT-Live". The `guides/realtime-webrtc`, `realtime-websocket` and `realtime-sip` URLs return the same bytes as `guides/voice-webrtc`, `voice-websockets` and `voice-sip` (checked with `cmp` for WebRTC; the byte sizes match for the other two). Cited URLs use the `voice-*` names.

---

## 1. OpenAI Realtime API

### 1.1 Status and current models

#### Takeaway

As of November 2026 the Realtime API is GA. The docs include a "Beta to GA migration" section, and `gpt-realtime` is described as the "first general-availability realtime model". The current speech-to-speech models are `gpt-realtime-2.1` and `gpt-realtime-2.1-mini`, with `gpt-realtime-2`, `gpt-realtime-1.5` and others still listed. `gpt-realtime` and `gpt-realtime-mini` are Deprecated. OpenAI now points new conversational apps at a separate product, **GPT-Live** (`gpt-live-1`). GPT-Live is a full-duplex voice model that delegates reasoning and tools to a backend. It is billed per minute, and it has its own endpoint `v1/live/sessions` with its own event formats.

#### Cited findings

- **GA migration** [docs] https://developers.openai.com/api/docs/guides/realtime.md: "If you still have a beta Realtime integration, migrate it to the GA interface before moving forward with new work." The changes listed: "Remove the `OpenAI-Beta: realtime=v1` header", "Use [`POST /v1/realtime/client_secrets`] ... to create ephemeral credentials", and "Use `/v1/realtime/calls` when establishing WebRTC sessions."
- **First GA model is now deprecated** [docs] https://developers.openai.com/api/docs/models/gpt-realtime.md: "Status: Deprecated", and "This is our first general-availability realtime model, capable of responding to audio and text inputs in realtime over WebRTC, WebSocket, or SIP connections."
- **Current flagship** [docs] https://developers.openai.com/api/docs/models/gpt-realtime-2.1.md: "GPT-Realtime-2.1 updates GPT-Realtime-2 with improved alphanumeric recognition, silence and noise handling, and interruption behavior. It supports speech-to-speech interactions with configurable reasoning effort, instruction following, and tool use". The model details list "128,000 context window", "32,000 max output tokens" and "Sep 30, 2024 knowledge cutoff".
- **Mini variant** [docs] https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini.md: "GPT-Realtime-2.1 mini is a distilled reasoning model for faster, lower-cost realtime voice interactions. It supports audio and text inputs over WebRTC, WebSocket, or SIP connections".
- **Catalogue, realtime and audio section** [docs] https://developers.openai.com/api/docs/models/all.md lists "GPT-Live-1 ... Our premier model for natural, expressive voice conversations with smooth interruption handling.", "GPT-Realtime-2.1 ... Reasoning model with tool use", "GPT-Realtime-2.1 mini", "GPT-Realtime-2", "GPT-Realtime-1.5", "GPT-Realtime: Deprecated", "GPT-Realtime mini: Deprecated" and "GPT-4o Realtime: Shut down".
- **GPT-Live is the new default for conversational voice** [docs] https://developers.openai.com/api/docs/guides/audio.md: "For a new conversational voice application, start with **[GPT-Live]** ... It can listen while speaking and keep the conversation moving while a backend agent reasons, uses tools, or completes a task." The same page adds: "Sharing a transport does not make GPT-Live and Realtime handshakes, credentials, or event formats interchangeable."
- **GPT-Live model** [docs] https://developers.openai.com/api/docs/models/gpt-live-1.md: "GPT-Live-1 is a full-duplex voice model for real-time conversations. It can listen and speak at the same time, and delegate reasoning and tool use to a backend agent." Its endpoint table shows "Live | `v1/live/sessions` | Supported" and "Realtime | `v1/realtime` | Not supported".

### 1.2 Connection methods: WebRTC, WebSocket, SIP

#### Takeaway

Each transport has a stated use. Use WebRTC for browser and mobile clients ("more consistent performance"). Use WebSocket for server-to-server. Use SIP for phone calls through a SIP trunk such as Twilio. Over WebRTC, audio travels on media tracks and JSON events travel on a data channel labelled `oai-events`. Over WebSocket, audio travels as base64 inside JSON text messages on the same channel as the events. A server can also attach a "sideband" WebSocket to a WebRTC or SIP session to run private tools.

#### Cited findings

- **Browser and mobile: WebRTC** [docs] https://developers.openai.com/api/docs/guides/voice-webrtc.md: "When connecting to a Realtime model from the client (like a web browser or mobile device), we recommend using WebRTC rather than WebSockets for more consistent performance."
- **WebRTC unified interface vs ephemeral key** [docs] same page: "The Realtime API supports two mechanisms for connecting from the browser: the unified interface and ephemeral API keys ... Use the unified interface for simpler setup and faster connections. This approach puts your application server in the critical path for session initialization." Unified flow: "The server combines that SDP with its session configuration in a multipart form and sends that to the OpenAI Realtime API, authenticating it with its standard API key", using "`/v1/realtime/calls`".
- **Events over the WebRTC data channel** [docs] same page: "To send and receive other client and server events, you can use the WebRTC peer connection's [data channel]". The example calls `pc.createDataChannel("oai-events")`. Also: "When connecting to a Realtime model via WebRTC, you don't have to handle audio events from the model in the same granular way you must with [WebSockets]."
- **Server-to-server: WebSocket** [docs] https://developers.openai.com/api/docs/guides/voice-websockets.md: "[WebSockets] are a broadly supported API for realtime data transfer, and a great choice for connecting to the OpenAI Realtime API in server-to-server applications. For browser and mobile clients, we recommend connecting via [WebRTC]." The endpoint in the example is `wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1`.
- **WebSocket carries audio as base64 in JSON** [docs] https://developers.openai.com/api/docs/guides/realtime-conversations.md: "If you are using WebSockets for audio, you will need to manually interact with the **input audio buffer** by sending audio to the server, sent with JSON events with base64-encoded audio."
- **Ordering differs by transport** [docs] same page: "In a Realtime API WebSocket connection all events are sent in the same channel and with the same ordering, while a WebRTC connection has separate channels for audio and control events."
- **SIP** [docs] https://developers.openai.com/api/docs/guides/voice-sip.md (Realtime section): "If you want to connect a phone number to the Realtime API, use a SIP trunking provider (e.g., Twilio). This is a service that converts your phone call to IP traffic." Point the trunk at "`sip:$PROJECT_ID@sip.api.openai.com;transport=tls`". The webhook fires "a [`realtime.call.incoming`] event", and the server accepts with `POST https://api.openai.com/v1/realtime/calls/$CALL_ID/accept`, whose example uses `"model": "gpt-realtime-2.1"`.
- **SIP media path (GPT-Live section of the same page)** [docs] same page: "SIP signaling uses TLS, and GPT-Live requires SRTP for call audio." Also "**SRTP media:** The API specifies a separate media IP address and UDP port in the negotiated SDP. Allow bidirectional SRTP traffic over UDP".
- **Sideband (GPT-Live variant of server controls)** [docs] https://developers.openai.com/api/docs/guides/voice-server-controls.md: "Attach your application server to an existing GPT-Live WebRTC or SIP session when the server needs to receive conversation events, execute private tools, or update the conversation. This second connection is called a **sideband WebSocket**." The Realtime SIP section of voice-sip.md likewise says to connect a WebSocket to the existing call "to stream events and issue realtime commands".
- **WebRTC startup latency** [docs] https://developers.openai.com/api/docs/guides/voice-webrtc.md: "WebRTC Abridged Roundtrip Protocol (WARP) reduces the time it takes to start a Realtime API voice session."

### 1.3 Ephemeral client secrets

#### Takeaway

Browsers never hold the standard API key. The app server mints a short-lived client secret with `POST /v1/realtime/client_secrets` and hands it to the browser. The secret defaults to 600 s and can be set from 10 to 7200 s. It limits only when sessions can be *created*. A session that has started keeps running after the secret expires.

#### Cited findings

- **Flow** [docs] https://developers.openai.com/api/docs/guides/voice-webrtc.md: "The browser makes a request to a developer-controlled server to mint an ephemeral API key." "The developer's server uses a [standard API key] to request an ephemeral key from the [OpenAI REST API], and returns that new key to the browser." "The browser uses the ephemeral key to authenticate a session directly with the OpenAI Realtime API as a [WebRTC peer connection]."
- **Expiry** [docs] https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create.md: "`seconds: optional integer (default: 600)` ... Select a value between `10` and `7200` (2 hours)." Also: "Expiration refers to the time after which a client secret will no longer be valid for creating sessions. The session itself may continue after that time once started. A secret can be used to create multiple sessions until it expires."

### 1.4 Session, conversation, items and the response lifecycle

#### Takeaway

A Realtime session is stateful. A **Session** holds configuration, a **Conversation** holds Items, and **Responses** append model output Items. The client drives it with client events (`session.update`, `input_audio_buffer.*`, `conversation.item.*`, `response.create`, `response.cancel`, `output_audio_buffer.clear`). The server reports through server events (`session.created`, `input_audio_buffer.speech_started`/`speech_stopped`, `response.created`, `response.output_audio.delta`, `response.function_call_arguments.done`, `response.done` and others). Sessions last at most 60 minutes. The voice is fixed once audio has been emitted.

#### Cited findings

- **Components** [docs] https://developers.openai.com/api/docs/guides/realtime-conversations.md: "A Realtime Session is a stateful interaction between the model and a connected client." Its parts: "The **Session** object, which controls the parameters of the interaction", "A **Conversation**, which represents user input Items and model output Items generated during the current session." and "**Responses**, which are model-generated audio or text Items that are added to the Conversation."
- **Lifecycle and limit** [docs] same page: "the server will send a [`session.created`] event indicating the session is ready. On the client, you can update the current session configuration with the [`session.update`] event." It continues: "The maximum duration of a Realtime session is **60 minutes**."
- **Voice lock** [docs] same page: "Once the model has emitted audio in a session, the `voice` cannot be modified for that session. For best quality, we recommend using `marin` or `cedar`."
- **`response.create`** [docs] https://developers.openai.com/api/reference/resources/realtime/client-events.md: "This event instructs the server to create a Response, which means triggering model inference. When in Server VAD mode, the server will create Responses automatically." And: "A Response will include at least one Item, and may have two, in which case the second will be a function call."
- **Server event names** [docs] https://developers.openai.com/api/reference/resources/realtime/server-events.md has section headings that include `session.created`, `conversation.item.added`, `conversation.item.truncated`, `input_audio_buffer.speech_started`, `input_audio_buffer.speech_stopped`, `input_audio_buffer.timeout_triggered`, `output_audio_buffer.started`, `output_audio_buffer.stopped`, `output_audio_buffer.cleared`, `response.created`, `response.done`, `response.output_audio.delta`, `response.output_audio_transcript.delta`, `response.function_call_arguments.done`, `response.mcp_call.in_progress` and `mcp_list_tools.completed`.
- **Speech-to-speech rationale** [docs] https://developers.openai.com/api/docs/guides/realtime-conversations.md: "One of the most powerful features of the Realtime API is voice-to-voice interaction with the model, without an intermediate text-to-speech or speech-to-text step. This enables lower latency for voice interfaces, and gives the model more data to work with around the tone and inflection of voice input."
- **The input transcript is not what the model heard** [docs] https://developers.openai.com/api/reference/resources/realtime/client-events.md (`input_audio_transcription`): "Input audio transcription is not native to the model, since the model consumes audio directly. Transcription runs asynchronously through [the /audio/transcriptions endpoint] and should be treated as guidance of input audio content rather than precisely what the model heard."

### 1.5 Voice activity detection (server_vad, semantic_vad, off)

#### Takeaway

VAD is on by default in speech-to-speech sessions, and `server_vad` is the default mode. `server_vad` detects silence and has three tuning knobs: `threshold` (default 0.5), `prefix_padding_ms` (default 300) and `silence_duration_ms` (default 500). `semantic_vad` uses a classifier to judge whether the user has finished. Its only tuning knob is `eagerness` (`low`/`medium`/`high`/`auto`, where `auto` equals `medium`). Both modes accept `create_response` and `interrupt_response`, which default to true. `server_vad` also offers `idle_timeout_ms`. Setting `turn_detection: null` turns VAD off, for push-to-talk. Setting both booleans to false keeps the VAD events but stops automatic responses.

#### Cited findings

- **Default** [docs] https://developers.openai.com/api/docs/guides/realtime-vad.md: "It is enabled by default in [speech-to-speech] Realtime sessions, but is optional and can be turned off." The two modes: "`server_vad`: Automatically chunks the audio based on periods of silence." and "`semantic_vad`: Chunks the audio when the model believes based on the words said by the user that they have completed their utterance."
- **server_vad parameters** [docs] same page: "`threshold`: Activation threshold (0 to 1). A higher threshold will require louder audio to activate the model, and thus might perform better in noisy environments." "`prefix_padding_ms`: Amount of audio (in milliseconds) to include before the VAD detected speech." "`silence_duration_ms`: Duration of silence (in milliseconds) to detect speech stop. With shorter values turns will be detected more quickly."
- **Defaults and the trade-off** [docs] https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create.md: `prefix_padding_ms` "Defaults to 300ms". `silence_duration_ms` "Defaults to 500ms. With shorter values the model will respond more quickly, but may jump in on short pauses from the user." `threshold` "this defaults to 0.5".
- **semantic_vad** [docs] https://developers.openai.com/api/docs/guides/realtime-vad.md: "This classifier scores the input audio based on the probability that the user is done speaking. When the probability is low, the model will wait for a timeout, whereas when it is high, there is no need to wait." Also: "With this mode, the model is less likely to interrupt the user during a speech-to-speech conversation".
- **eagerness** [docs] same page: "`auto` is the default value, and is equivalent to `medium`." "`low` will let the user take their time to speak." "`high` will chunk the audio as soon as possible."
- **create_response / interrupt_response** [docs] client_secrets reference (URL above): `interrupt_response` is "Whether or not to automatically interrupt (cancel) any ongoing response with output to the default conversation ... when a VAD start event occurs. If `true` then the response will be cancelled, otherwise it will continue until complete." On both flags: "If both `create_response` and `interrupt_response` are set to `false`, the model will never respond automatically but VAD events will still be emitted."
- **idle_timeout_ms** [docs] same reference: "Optional timeout after which a model response will be triggered automatically. This is useful for situations in which a long pause from the user is unexpected, such as a phone".
- **Turn detection off** [docs] https://developers.openai.com/api/docs/guides/realtime-conversations.md: "VAD can be disabled by setting `turn_detection` to `null` with the [`session.update`] client event. This can be useful for interfaces where you would like to take granular control over audio input, like [push to talk] interfaces."
- **Why push-to-talk** [docs] same page: "For some apps this works surprisingly well -- it gives the users control over interactions, avoids VAD failures, and it feels snappy because we're not waiting for a VAD timeout."
- **Noise reduction feeds VAD** [docs] client_secrets reference: "Noise reduction filters audio added to the input audio buffer before it is sent to VAD and the model. Filtering the audio can improve VAD and turn detection accuracy (reducing false positives)". The `type` field must be "`near_field` or `far_field`".

### 1.6 Interruption and truncation

#### Takeaway

With VAD on, the server detects user speech, cancels the in-flight response and starts a new one. Because "the server will produce audio faster than realtime", the conversation can hold assistant audio and text that the user never heard. Truncation removes it. Over WebRTC and SIP the server tracks playback and truncates automatically. Over WebSocket the *client* must stop playback, measure how many ms were played, and send `conversation.item.truncate` with `audio_end_ms`. Truncation also deletes the unheard part of the text transcript. OpenAI's reason: the context should hold nothing the user has not heard. For WebRTC push-to-talk, `output_audio_buffer.clear` (WebRTC and SIP only) cuts playback and truncates.

#### Cited findings

- **What VAD does on barge-in** [docs] https://developers.openai.com/api/docs/guides/realtime-conversations.md: "Realtime API handles interruptions when VAD is enabled, in that it detects user speech, cancels the ongoing response, and starts a new one. However in this scenario you will want the model to know where it was interrupted, so it can continue the conversation naturally (for example if the user says "what was that last thing?")."
- **WebRTC/SIP: automatic** [docs] same page: "In WebRTC and SIP connections the server manages a buffer of output audio, and thus knows how much audio has been played at a given moment. The server will automatically truncate unplayed audio when there's a user interruption."
- **WebSocket: client-driven** [docs] same page: "With a WebSocket connection the client manages audio playback, and thus must stop playback and handle truncation." Then: "On `input_audio_buffer.speech_started`, immediately stop playback of the model's audio and discard any queued audio for that item. Record how many milliseconds of that item's audio the user actually heard." The docs' example sends `"audio_end_ms": 1500`. On completion: "the server cancels it and sends `response.done` with `response.status` set to `cancelled`. Use that event to observe completion; don't wait for it before stopping playback or sending the truncation event."
- **Why truncate (model transcript vs what was heard)** [docs] https://developers.openai.com/api/reference/resources/realtime/client-events.md (`conversation.item.truncate`): "The server will produce audio faster than realtime, so this event is useful when the user interrupts to truncate audio that has already been sent to the client but not yet played. This will synchronize the server's understanding of the audio with the client's playback." And: "Truncating audio will delete the server-side text transcript to ensure there is not text in the context that hasn't been heard by the user."
- **Transcript alignment caveat** [docs] https://developers.openai.com/api/docs/guides/realtime-conversations.md: "The realtime model doesn't have enough information to precisely align transcript and audio, and thus `conversation.item.truncate` will cut the audio at a given place and remove the text transcript for the unplayed portion. This solves the problem of removing unplayed audio but doesn't provide a truncated transcript."
- **`output_audio_buffer.clear`** [docs] client-events reference: "**WebRTC/SIP Only:** Emit to cut off the current audio response. This will trigger the server to stop generating audio and emit a `output_audio_buffer.cleared` event. This event should be preceded by a `response.cancel` client event to stop the generation of the current response."
- **Push-to-talk over WebRTC** [docs] https://developers.openai.com/api/docs/guides/realtime-conversations.md: "If there is ongoing output playback from the model, send an [`output_audio_buffer.clear`] event to clear out the unplayed audio, this truncates the conversation as well."
- **speech_started as the barge-in hook** [docs] https://developers.openai.com/api/reference/resources/realtime/server-events.md: "Sent by the server when in `server_vad` mode to indicate that speech has been detected in the audio buffer. ... The client may want to use this event to interrupt audio playback or provide visual feedback to the user."

### 1.7 Function calling and MCP in a realtime session

#### Takeaway

Realtime function calling works the same way as text function calling, but it runs as events. The model emits a `function_call` item (name, arguments, `call_id`). The client runs the function, sends a `function_call_output` item with `conversation.item.create`, and then must send `response.create` to get the model to speak the result. Realtime also supports **remote MCP tools** (`type: "mcp"` with `server_url`), which the Realtime API runs itself. After MCP calls finish, the client must still send `response.create`. On whether the model can keep talking during a pending call: the Realtime guides document no async or non-blocking tool flag (not found in the Realtime conversations, tools/MCP or client-events pages as of 2026-11-19). OpenAI's "async tool calling" (`async: true`) is a Responses API feature "supported by GPT-6 Astra and later models". Realtime's documented way to fill the gap is **preambles**, short spoken updates before tool use. GPT-Live is OpenAI's architecture for talking while backend work runs.

#### Cited findings

- **Four-step loop** [docs] https://developers.openai.com/api/docs/guides/realtime-conversations.md: "If when processing input, the model determines it should make a function call, it will add items to the conversation representing arguments to a function call." Then: "When the custom code has been executed, the client will create new conversation items that contain the output of the function call, and ask the model to respond."
- **Tools at session or response scope** [docs] same page: "Session: `session.tools` property in [`session.update`]" and "Response: `response.tools` property in [`response.create`]".
- **Detecting the call** [docs] same page: "`response.output[0].type` | When set to `function_call`, indicates this response contains arguments for a named function call." "`response.output[0].call_id` | A system-generated ID for this function call - **you will need this ID to pass a function call result back to the model**."
- **Returning the result** [docs] same page: the example item has `"type": "function_call_output"`, `"call_id": "call_sHlR7iaFwQ2YQOqm"`. Then: "Once we have added the conversation item containing our function call results, we again emit the [`response.create`] event from the client. This will trigger a model response using the data from the function call."
- **MCP supported** [docs] https://developers.openai.com/api/docs/guides/realtime-mcp.md: "Use function tools when your application should execute the tool and return the result. Use MCP tools when the Realtime API should connect to a remote tool server for you." Also: "Unlike Realtime `function` tools, remote MCP tools are **executed by the Realtime API itself**."
- **MCP follow-up is manual** [docs] same page: "`response.done` for a response can arrive before its MCP calls finish. After the response is done and all of its MCP calls have finished, send another [`response.create`] event to let the model use the results and proceed with the conversation. ... The Realtime API doesn't create these follow-up responses automatically."
- **MCP approval** [docs] same page: "**If approval is required**, the server adds a conversation item whose `item.type` is `mcp_approval_request`. Your client must answer it with an `mcp_approval_response` item." On tool loading: "While listing is still in progress, the model can't call a tool that hasn't loaded yet."
- **Connectors deprecated** [docs] same page: "`connector_id` is deprecated for models released after September 1, 2026. Use `server_url` to connect to a remote MCP server".
- **Async tool calling is a Responses feature** [docs] https://developers.openai.com/api/docs/guides/async-tool-calling.md: "A normal [function call] pauses the model's turn to wait for a tool response. Set `async: true` on a function or custom tool definition to let the model continue working after issuing that call". Results arrive "in a later Responses request". "Async tool calling is supported by GPT-6 Astra and later models."
- **Preambles in Realtime** [docs] https://developers.openai.com/api/docs/guides/voice-prompting.md: "Preambles are short spoken updates that keep a voice agent feeling responsive while it reasons, looks something up, or calls a tool." And: "`gpt-realtime-2` generates preambles by default."
- **GPT-Live: talking during backend work** [docs] https://developers.openai.com/api/docs/guides/live.md: "Backend work can continue when the caller interrupts the assistant; your application decides whether to finish or cancel it." [docs] https://developers.openai.com/api/docs/guides/live-delegation.md: "GPT-Live can continue speaking while your application reviews a backend result." And: "Interrupting the spoken conversation leaves backend work running."

### 1.8 Audio formats and token accounting

#### Takeaway

On WebSocket, the formats are PCM16 mono at 24 kHz (the default) or 16 kHz, or G.711 μ-law/A-law at 8 kHz. On WebRTC and SIP the codec is negotiated through SDP, so `audio.format` is omitted. Audio tokens accrue at 1 token per 100 ms of user audio and 1 token per 50 ms of assistant audio. Prompt caching is automatic but best-effort, and truncation "busts" the cache.

#### Cited findings

- **Formats** [docs] https://developers.openai.com/api/docs/guides/voice-websockets.md (GPT-Live section; the Realtime session schema uses the same `audio/pcm`, `audio/pcmu`, `audio/pcma` types): "`{"type":"audio/pcm","rate":24000}`: mono signed 16-bit little-endian PCM at 24 kHz; the default." "`{"type":"audio/pcmu","rate":8000}`: G.711 μ-law at 8 kHz, one byte per sample." "`{"type":"audio/pcma","rate":8000}`: G.711 A-law at 8 kHz, one byte per sample." Also: "A matching G.711 stream can pass through without conversion to PCM."
- **Realtime session example** [docs] https://developers.openai.com/api/docs/guides/realtime-conversations.md: `format: { type: "audio/pcm", rate: 24000 }` inside `session.update` for `model: "gpt-realtime-2.1"`.
- **WebRTC negotiates format** [docs] https://developers.openai.com/api/docs/guides/voice-webrtc.md (GPT-Live section): "WebRTC negotiates the audio format through SDP, so omit `audio.format` from session configuration."
- **Tokens per audio time** [docs] https://developers.openai.com/api/docs/guides/voice-latency-cost.md: "Audio tokens in user messages are 1 token per 100 ms of audio, while audio tokens in assistant messages are 1 token per 50ms of audio."
- **Caching** [docs] same page: "Realtime API supports [prompt caching], which is applied automatically ... though this is best-effort and not guaranteed." And: "Truncation busts the cache near the beginning of the conversation, and if truncation occurs on every turn then cache rate will be very low." (This is context-window truncation, controlled by `session.truncation.retention_ratio`. It is not the same as `conversation.item.truncate`.)

### 1.9 Pricing (as of November 2026)

#### Takeaway

The pricing page fetched fine (HTTP 200 for the `.md` variant). Per 1M tokens, as of November 2026: `gpt-realtime-2.1` audio costs $32 input, $64 output and $0.40 cached input. Its text costs $4 input and $24 output. `gpt-realtime-2.1-mini` audio costs $10 input, $20 output and $0.30 cached. GPT-Live is priced by time ($0.05/min, billed per second), and backend model use is charged separately.

#### Cited findings

- **Pricing table** [docs] https://developers.openai.com/api/docs/pricing.md, "Realtime & Audio" table rows: "| gpt-realtime-2.1 | Audio | $32.00 | $64.00 | $0.40 |", "| gpt-realtime-2.1 | Text | $4.00 | $24.00 | $0.40 |", "| gpt-realtime-2.1-mini | Audio | $10.00 | $20.00 | $0.30 |", "| gpt-realtime-2.1-mini | Text | $0.60 | $2.40 | $0.06 |", "| gpt-realtime | Audio | $32.00 | $64.00 | $0.40 |" (columns: Model, Modality, Input, Output, Cached input).
- **Model page agrees** [docs] https://developers.openai.com/api/docs/models/gpt-realtime-2.1.md, "Audio tokens": "| Input | $32 | 1M tokens |", "| Cached input | $0.4 | 1M tokens |", "| Output | $64 | 1M tokens |".
- **GPT-Live** [docs] https://developers.openai.com/api/docs/pricing.md: "| gpt-live-1 | $0.05 |" (price per minute). Also: "voice sessions are billed per second, without rounding up to a whole minute. Backend model and tool usage is charged separately."
- **Transcription and TTS prices** [docs] same page: "| gpt-live-transcribe | Live transcription | - | - | $0.017 / minute |", "| gpt-transcribe | Transcription | - | - | $0.0045 / minute |", "| gpt-4o-transcribe | Transcription | $2.50 | $10.00 | $0.006 / minute |", "| gpt-4o-mini-tts | Audio | - | $12.00 | - |".

### 1.10 Voice-agent architectures: speech-to-speech vs chained (and GPT-Live)

#### Takeaway

As of November 2026, OpenAI's "Voice agents" guide names three architectures, not two. (1) **GPT-Live**: a full-duplex front model that delegates to a backend. (2) **Realtime API**: one speech-to-speech model handles speech, reasoning and tools. (3) **Chained pipeline**: STT, then a text agent, then TTS. The stated trade-off for the chained pipeline is visibility and control: you can "inspect or transform intermediate text" and "replace each component independently". The Realtime API is pitched for "barge-in, low first-audio latency, natural turn taking, and realtime tool use". The guide's rule: choose the audio architecture first, then design the agent as you would for text.

#### Cited findings

- **Architecture table** [docs] https://developers.openai.com/api/docs/guides/voice-agents.md: "| GPT-Live | Full-duplex conversations with a separate backend | Keep your existing text workflow and choose its backend independently while the conversation continues. |" "| Realtime API | Speech, reasoning, and tool use in one session | Use one model to interpret audio, decide what to do, and respond in speech. |" "| Chained voice pipeline | Control over each speech and text stage | Inspect or transform intermediate text and replace each component independently. |"
- **When to chain** [docs] same page: "Use the chained path when you want to inspect or transform text between speech recognition, your agent, and speech generation." And: "For example, you might store the transcript, run policy checks before the text agent responds, call internal systems, then generate speech only after the workflow reaches an approved answer."
- **When to use Realtime** [docs] https://developers.openai.com/api/docs/guides/realtime.md: "This is the best starting point for voice agents that need barge-in, low first-audio latency, natural turn taking, and realtime tool use."
- **Same building blocks** [docs] https://developers.openai.com/api/docs/guides/voice-agents.md: "The voice surface changes the transport and audio loop, but the core workflow decisions are the same". Also: "The practical rule is: choose the audio architecture first, then design the rest of the agent workflow the same way you would for text."
- **Latency measurement guidance** [docs] same page: "Measure how long callers wait for a useful spoken answer. Track backend time separately to find delays, and compare the median and 95th percentile across similar calls." And: "Measure acknowledgments such as “I'm checking” separately from the answer the caller needs."

### 1.11 Transcription and TTS models (as of November 2026)

#### Takeaway

As of November 2026, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` and `whisper-1` are deprecated and shut down on 2027-02-26. The recommended models are `gpt-transcribe` (file transcription and committed turns) and `gpt-live-transcribe` (live transcription). For TTS, `gpt-4o-mini-tts`, `tts-1` and `tts-1-hd` are deprecated and shut down on 2027-01-06. OpenAI tells TTS users to move to `gpt-realtime-2.1-mini` on the Realtime API, which is a change of workflow because that model does not serve `/v1/audio/speech`.

#### Cited findings

- **TTS deprecation** [docs] https://developers.openai.com/api/docs/guides/text-to-speech.md: "The `tts-1`, `tts-1-hd`, and `gpt-4o-mini-tts` models are deprecated and will shut down on **January 6, 2027**. Migrate to `gpt-realtime-2.1-mini` using the [Realtime API]. This is a change of API workflow: `gpt-realtime-2.1-mini` isn't a supported model for `/v1/audio/speech`."
- **TTS model page** [docs] https://developers.openai.com/api/docs/models/gpt-4o-mini-tts.md: "Status: Deprecated".
- **STT deprecation** [docs] https://developers.openai.com/api/docs/guides/transcription.md: "`whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `gpt-4o-transcribe-diarize`, and `/v1/audio/translations` are deprecated and will shut down on **February 26, 2027**."
- **Recommended STT** [docs] same page: "Committed-turn transcription over WebSocket | `gpt-transcribe` with [realtime transcription]". The workflow table recommends `gpt-live-transcribe` for live audio. [docs] https://developers.openai.com/api/docs/models/gpt-transcribe.md: "GPT-Transcribe is a speech-to-text model for completed audio files, streamed file transcripts, and committed turns in Realtime sessions over WebSocket."
- **VAD differs by transcription model** [docs] https://developers.openai.com/api/docs/guides/realtime-vad.md: "`gpt-live-transcribe` and `gpt-realtime-whisper` require turn detection to be omitted or set to `null`. Send `input_audio_buffer.commit` to finish each audio turn with these models."

---

## 2. Google Gemini Live API

### Takeaway

As of November 2026, the Gemini Live API runs only over a **stateful WebSocket (WSS)**. It is reached directly from the server, or from the client with ephemeral tokens. WebRTC is available only through partner integrations (LiveKit, Pipecat and others). The current models are `gemini-3.8-live` (Stable, the default low-latency audio-to-audio model) and `gemini-3.8-live-extended-thinking` (Stable, async tools only), plus the preview models `gemini-3.1-flash-live-preview` and `gemini-2.5-flash-native-audio-preview-12-2025`. The current docs describe these as audio-to-audio or "native audio" models. **The term "half-cascade" was not found** in any Gemini page fetched on 2026-11-19 (Live overview, capabilities, tools, session management, model pages, pricing, llms.txt).

On formats: input is 16-bit PCM at 16 kHz and output is 24 kHz. Automatic VAD is on by default. It can be tuned (start/end sensitivity, `prefixPaddingMs`, `silenceDurationMs`), run as "hybrid", or disabled and replaced by `activityStart`/`activityEnd`. On interruption, the server discards the generation and any pending function calls, and the client must flush its playback buffer.

Function calling must be handled by the client. `behavior: NON_BLOCKING` makes a call asynchronous. The `scheduling` field (`INTERRUPT`, `WHEN_IDLE`, `SILENT`) decides how the model reacts to the result. Session limits without compression: audio-only 15 min, audio+video 2 min, and about 10 min per connection. The extensions are context-window compression and session resumption (tokens valid 2 h). Paid pricing as of November 2026 for the 3.8 Live family: audio input $3.00/1M tokens ($0.005/min), audio output $12.00/1M ($0.018/min).

### Cited Findings

- **Transport** [docs] https://aistudio.google.com/docs/live-api.md: "Protocol | Stateful WebSocket connection (WSS)". The two approaches: "**Server-to-server**: Your backend connects to the Live API using [WebSockets]" and "**Client-to-server**: Your frontend code connects directly to the Live API using [WebSockets] to stream data, bypassing your backend." The note adds: "for production environments, in order to mitigate security risks, we recommend using [ephemeral tokens] instead of standard API keys." On WebRTC: "you can use a third-party integration that supports the Gemini Live API over WebRTC or WebSockets."
- **Endpoint** [docs] https://aistudio.google.com/docs/live-api/get-started-websocket.md: `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=YOUR_API_KEY`. The ephemeral-token variant uses `...BidiGenerateContentConstrained?access_token={short-lived-token}`.
- **Audio formats** [docs] https://aistudio.google.com/docs/live-api.md: "Audio (raw 16-bit PCM audio, 16kHz, little-endian)" in and "Audio (raw 16-bit PCM audio, 24kHz, little-endian)" out. [docs] https://aistudio.google.com/docs/live-api/capabilities.md: "Input audio is natively 16kHz, but the Multimodal Live API will resample if needed so any sample rate can be sent."
- **Current model** [docs] https://aistudio.google.com/docs/models/gemini-3.8-live.md: "Gemini 3.8 Live (`gemini-3.8-live`) is the default option for low-latency, audio-to-audio voice agent experiences and real-time dialogue without reasoning-induced delays. It supports interleaved reasoning, asynchronous and synchronous function calling, full-session client content updates, and built-in proactive audio." Versions: "Stable: `gemini-3.8-live`". Token limits: "**Input token limit** 131,072" and "**Output token limit** 65,536".
- **Extended thinking model** [docs] https://aistudio.google.com/docs/models/gemini-3.8-live-extended-thinking.md: "our high-reasoning audio-to-audio Live API model for complex, multi-step problem solving during real-time voice interactions. It processes configurable background reasoning (`low`, `medium`, `high`), thought summaries, and asynchronous tool calls while streaming continuous audio responses."
- **Preview models** [docs] https://aistudio.google.com/docs/models/gemini-3.1-flash-live-preview.md: "Gemini 3.1 Flash Live Preview is our legacy preview audio-to-audio model". Versions: "Preview: `gemini-3.1-flash-live-preview`". [docs] https://aistudio.google.com/docs/models/gemini-2.5-flash-native-audio-preview-12-2025.md: "Preview: `gemini-2.5-flash-native-audio-preview-12-2025`".
- **Native audio** [docs] https://aistudio.google.com/docs/live-api/capabilities.md: "The native audio models only support `AUDIO response modality. If you need the model response as text, use the [output audio transcription] feature." (The quote keeps the page's unbalanced backtick.)
- **Interruption** [docs] https://aistudio.google.com/docs/live-api/capabilities.md: "When VAD detects an interruption, the ongoing generation is canceled and discarded. Only the information already sent to the client is retained in the session history." And: "The Gemini server then discards any pending function calls and sends a `BidiGenerateContentServerContent` message with the IDs of the canceled calls." The sample checks `response.server_content.interrupted is True` with the comment "you should stop playing audio and clear queued playback here."
- **Client must flush** [docs] https://aistudio.google.com/docs/live-api/best-practices.md: "When the user speaks while the model is replying, the server sends a `server_content` message with `"interrupted": true`. You must immediately discard your client-side audio buffer to prevent the agent from continuing to talk over the user." Same page: "Send audio in chunks of 20ms to 40ms." and "Don't buffer input audio significantly (such as 1 second) before sending. Send small chunks (20ms - 100ms) to minimize latency."
- **Automatic VAD** [docs] https://aistudio.google.com/docs/live-api/capabilities.md: "By default, the model automatically performs VAD on a continuous audio input stream. VAD can be configured with the [`realtimeInputConfig.automaticActivityDetection`] field". The config example sets `startOfSpeechSensitivity`, `endOfSpeechSensitivity`, `prefixPaddingMs: 20` and `silenceDurationMs: 100`. Pause handling: "When the audio stream is paused for more than a second ... an [`audioStreamEnd`] event should be sent to flush any cached audio."
- **silenceDurationMs guidance** [docs] same page: "**Recommended (500ms–800ms):** Provides a good balance ... The server's internal default is approximately 800ms." And: "**Too low (e.g., 100ms–200ms):** The system ends speech turns during natural pauses, splitting a single utterance into multiple small audio fragments."
- **Hybrid VAD** [docs] same page: "Hybrid VAD combines the benefits of automatic VAD (robust speech start detection) and manual VAD (low-latency response finalization)." The client signal works as follows: "The server treats the `audio_stream_end` signal as an immediate finalization prompt, bypassing the default server-side silence detection delay".
- **Manual VAD** [docs] same page: "the automatic VAD can be disabled by setting `realtimeInputConfig.automaticActivityDetection.disabled` to `true` in the setup message. In this configuration the client is responsible for detecting user speech and sending [`activityStart`] and [`activityEnd`] messages". Advice: "use an end-of-speech silence threshold of at least **500ms** in your client's voice activity detector."
- **Function calling is manual** [docs] https://aistudio.google.com/docs/live-api/tools.md: "Unlike the `generateContent` API, the Live API doesn't support automatic tool response handling. You must handle tool responses manually in your client code." Also: "After receiving tool calls, the client should respond with a list of `FunctionResponse` objects using the `session.send_tool_response` method."
- **Blocking by default; NON_BLOCKING** [docs] same page: "Function calling executes sequentially by default, meaning execution pauses until the results of each function call are available. This ensures sequential processing, which means you won't be able to continue interacting with the model while the functions are being run." And: "`NON-BLOCKING` ensures the function runs asynchronously while you can continue interacting with the model." Model support: "Asynchronous function calling is supported on `gemini-3.8-live` and required on `gemini-3.8-live-extended-thinking`. It is not supported on `gemini-3.1-flash-live-preview`".
- **Scheduling** [docs] same page: "Interrupt what it's doing and tell you about the response it got right away (`scheduling="INTERRUPT"`)", "Wait until it's finished with what it's currently doing (`scheduling="WHEN_IDLE"`)", and "Or do nothing and use that knowledge later on in the discussion (`scheduling="SILENT"`)". *Inconsistency in the docs:* the model-comparison table on https://aistudio.google.com/docs/live-api/capabilities.md writes "Function scheduling (`SILENT`, `WHEN_IDLE`, `INTERRUPTED`) is supported." The code sample on the tools page uses `FunctionResponseScheduling.INTERRUPT`.
- **Supported tools** [docs] https://aistudio.google.com/docs/live-api/tools.md lists Search "Supported" on all four models. Google Maps, Code execution and URL context are "Not supported" on all four. **MCP was not found** on the Live tools page (the only "MCP" string is the docs-site banner about the Gemini Docs MCP server).
- **Async turn semantics** [docs] https://aistudio.google.com/docs/live-api/capabilities.md (Extended Thinking column): "When asynchronous reasoning is active, `turnComplete: true` does not indicate an idle session; check `interaction_status` (`IN_PROGRESS` versus `IDLE`)."
- **Session limits** [docs] https://aistudio.google.com/docs/live-api/session-management.md: "Without compression, audio-only sessions are limited to 15 minutes, and audio-video sessions are limited to 2 minutes. Exceeding these limits will terminate the session (and therefore, the connection), but you can use [context window compression] to extend sessions to an unlimited amount of time." And: "The lifetime of a connection is limited as well, to around 10 minutes."
- **Compression and resumption** [docs] same page: compression uses "a [sliding-window mechanism]" (JS: `contextWindowCompression: { slidingWindow: {} }`). Resumption: "To prevent session termination when the server periodically resets the WebSocket connection, configure the [sessionResumption] field". Token lifetime: "Resumption tokens are valid for 2 hr after the last sessions termination." GoAway: "The server sends a [GoAway] message that signals that the current connection will soon be terminated."
- **Context window** [docs] https://aistudio.google.com/docs/live-api/capabilities.md: "128k tokens for [native audio output] models" and "32k tokens for other Multimodal Live API models". [docs] https://aistudio.google.com/docs/live-api/best-practices.md: "native audio tokens accumulate rapidly (approximately 25 tokens per sec of audio)."
- **Ephemeral tokens** [docs] https://aistudio.google.com/docs/live-api/ephemeral-tokens.md: "Ephemeral tokens are short-lived authentication tokens for accessing the Gemini API through [WebSockets]." Defaults: "By default, you'll have 1 minute to start new Live API sessions using the token from this request (`newSessionExpireTime`), and 30 minutes to send messages over that connection (`expireTime`)." The sample sets `'uses': 1, # The ephemeral token can only be used to start a single session`.
- **Pricing (paid tier, as of November 2026)** [docs] https://aistudio.google.com/docs/pricing.md, section "Gemini 3.8 Live, Gemini 3.8 Live Extended Thinking, and Gemini 3.1 Flash Live Preview": input "$0.75 (text)", "$3.00 or $0.005/min (audio)". Output "(including thinking tokens)": "$4.50 (text)", "$12.00 or $0.018/min (audio)". The free tier reads "Free of charge".

---

## 3. Anthropic (Claude API): audio and realtime

### Takeaway

As of 2026-11-19 the Claude API documents **no audio input, audio output, speech or realtime/voice API**. No such page is listed in the docs index (`platform.claude.com/docs/llms.txt`, 1,001 lines). The only "transcript" hit is a compliance page about session transcripts. The features overview lists vision (images) and PDF support but no audio. The models overview says all current models take "text and image input, text output". Voice exists only as a **product** feature in the Claude apps. The help centre documents "voice mode" as beta on mobile, desktop and web, with hands-free and push-to-talk modes. That same page says the user's "speech is converted to text", which suggests a chained (STT, then text model, then TTS) design. That is an inference from the help page, not an Anthropic architecture statement.

### Cited Findings

- **Docs index** [docs] https://platform.claude.com/docs/llms.txt: a case-insensitive grep for `audio|voice|speech|realtime|real-time|transcri|tts` matched one line: "- [Session transcripts](https://platform.claude.com/docs/en/manage-claude/compliance-sessions.md) - Retrieve session transcripts". **Audio, voice and realtime API pages: not found in llms.txt as of 2026-11-19.**
- **Features overview** [docs] https://platform.claude.com/docs/en/build-with-claude/overview.md lists "[Vision (images)] | Claude can read and analyze images that you send to it." and "[PDF support] | Send PDFs to Claude so it can read the text, pictures, charts and tables in them." **Audio or speech features: not found in the features overview as of 2026-11-19.**
- **Model modalities** [docs] https://platform.claude.com/docs/en/about-claude/models/overview.md: "All current models support text and image input, text output, multilingual capabilities, vision, and tool use."
- **Voice mode (product, not API)** [docs] https://support.claude.com/en/articles/11101966-using-voice-mode-on-claude-mobile-apps (page title "Use voice mode"): "Voice mode is a beta feature available to all plans (Free, Pro, Max, Ultra, Team, and Enterprise) on Claude Mobile (iOS and Android), Claude Desktop, and the web, but is built to work best from your phone."
- **Turn-taking modes in the product** [docs] same page: "In hands-free mode, Claude listens continuously and responds to natural pauses in your speech." And: "If Claude does interrupt you, simply start speaking again—Claude will stop and listen." Push-to-talk: "In this mode, you hold a button while speaking and release it when you're done."
- **Speech converted to text** [docs] same page: "By default, we don't keep the audio from your voice conversations. Your speech is converted to text, the recording is deleted, and the transcript is saved in your chat history."
- **Tools add delay in voice** [docs] same page: "Note: Not every result can be shown on screen in voice mode, and using several tools at once can add a short delay."

---

## 4. Transport and media specs

### Takeaway

WebSocket (RFC 6455) is a thin message-framing layer over **TCP**, built for browsers. TCP is reliable and ordered, so one lost packet stalls everything behind it (head-of-line blocking). That cost is acceptable on server-to-server links but hurts on lossy last-mile links. WebRTC (W3C Recommendation, 13 March 2025, plus the IETF RTCWEB RFCs from January 2021) carries media as RTP over **UDP** by default. It must encrypt media with SRTP (DTLS-SRTP keying), it must run full ICE for NAT traversal, and TCP is only a fallback. RFC 8835 names TCP's head-of-line blocking as a performance problem. WebRTC must support Opus and G.711. Opus frames run from 2.5 to 60 ms, with algorithmic delay from 5 ms, which suits interactive speech.

Echo cancellation matters for voice agents. In a full-duplex session the agent's own voice comes out of the speaker and back into the microphone. Without AEC the server's VAD can treat that as user speech and interrupt the agent (self-barge-in). Media Capture and Streams defines `echoCancellation`, `noiseSuppression` and `autoGainControl` constraints. RFC 7874 says WebRTC endpoints SHOULD include AEC. One detail: the spec's `"remote-only"` echo-cancellation mode targets audio "sourced from WebRTC RTCPeerConnections". Agent audio that arrives over WebSocket and plays through Web Audio is not a peer-connection track. Whether the default `true` mode cancels it is browser-dependent and not specified in the passages read. (The last two sentences are an inference from the spec text.)

### Cited Findings

- **WebSocket = framing over TCP** [spec] https://www.rfc-editor.org/rfc/rfc6455.txt (Abstract): "The protocol consists of an opening handshake followed by basic message framing, layered over TCP." Section 1.5: "The WebSocket Protocol is designed on the principle that there should be minimal framing (the only framing that exists is to make the protocol frame-based instead of stream-based and to support a distinction between Unicode text and binary frames)." Also: "Basically it is intended to be as close to just exposing raw TCP to script as possible given the" constraints of the Web.
- **WebRTC 1.0 status** [spec] https://www.w3.org/TR/webrtc/: "WebRTC: Real-Time Communication in Browsers" "W3C Recommendation 13 March 2025", this version "https://www.w3.org/TR/2025/REC-webrtc-20250313/".
- **RTCWEB overview** [spec] https://www.rfc-editor.org/rfc/rfc8825.txt ("Overview: Real-Time Protocols for Browser-Based Applications", Standards Track, January 2021): "Data transport: For example, TCP and UDP, and the means to securely set up connections between entities, as well as the functions for deciding when to send data: congestion management, bandwidth estimation, and so on." It lists echo cancellation as a local function: "Examples in this category include echo cancellation (some forms of it), local authentication and authorization mechanisms".
- **UDP primary, TCP for WebSockets/fallback** [spec] https://www.rfc-editor.org/rfc/rfc8835.txt ("Transports for WebRTC"): "UDP [RFC0768]: This is the protocol assumed by most protocol elements described." "TCP [RFC0793]: This is used for HTTP/WebSockets, as well as TURN/TLS and ICE-TCP." On TCP relays: "using TCP between the WebRTC endpoint's TURN server and the peer may result in more performance problems than using UDP, e.g., due to head of line blocking."
- **ICE required** [spec] same RFC: "ICE [RFC8445] MUST be supported. The implementation MUST be a full ICE implementation, not ICE-Lite." Data channels: "endpoints MUST support SCTP over DTLS over ICE."
- **SRTP required** [spec] https://www.rfc-editor.org/rfc/rfc8834.txt: "WebRTC endpoints MUST NOT send packets using the basic RTP/AVP profile or the RTP/AVPF profile; they MUST employ the full RTP/SAVPF profile to protect all RTP and RTCP packets that are generated. In other words, implementations MUST use SRTP and Secure RTCP (SRTCP)." [spec] https://www.rfc-editor.org/rfc/rfc8827.txt: "Implementations MUST support SRTP [RFC3711]. Implementations MUST support DTLS [RFC6347] and DTLS-SRTP [RFC5763] [RFC5764] for SRTP keying."
- **Mandatory audio codecs** [spec] https://www.rfc-editor.org/rfc/rfc7874.txt: "WebRTC endpoints are REQUIRED to implement the following audio codecs:", namely "Opus [RFC6716] with the payload format specified in [RFC7587]." and "PCMA and PCMU (as specified in ITU-T Recommendation G.711 [G.711])".
- **AEC in WebRTC endpoints** [spec] same RFC, Section 5: "WebRTC endpoints SHOULD include an AEC or some other form of echo control." Context: "people using the interactive audio and video capabilities to communicate with each other via web browsers running on a notebook computer that has a built-in microphone and speakers. The notebook-as-communication-device paradigm presents challenging echo cancellation problems". Also: "endpoints SHOULD have the ability to detect the presence of a headset and disable echo cancellation."
- **Opus frame sizes and delay** [spec] https://www.rfc-editor.org/rfc/rfc6716.txt: "Opus is designed to handle a wide range of interactive audio applications, including Voice over IP, videoconferencing, in-game chat, and even live, distributed music performances." Delay: "The Opus codec scales from 6 kbit/s narrowband mono speech to 510 kbit/s fullband stereo music, with algorithmic delays ranging from 5 ms to 65.2 ms." Frame sizes: "Opus can encode frames of 2.5, 5, 10, 20, 40, or 60 ms. It can also combine multiple frames into packets of up to 120 ms." On the trade-off, longer frames reduce bitrate, "However, it increases latency and sensitivity to packet losses".
- **Media Capture and Streams status** [spec] https://www.w3.org/TR/mediacapture-streams/: "W3C Candidate Recommendation Draft 12 November 2026".
- **echoCancellation** [spec] same spec: "When one or more audio streams are being played in the processes of various microphones, it is often desirable to attempt to remove sound being played from the input signals recorded by the microphones. This is referred to as echo cancellation." `EchoCancellationModeEnum` defines "all": "The system MUST attempt to remove all sound being played by the system from the input signal of the microphone." It also defines "remote-only": "The system MUST attempt to remove the sound from incoming audio MediaStreamTracks sourced from WebRTC RTCPeerConnections." (The original renders "MediaStreamTrack s" with a space from link markup.)
- **autoGainControl / noiseSuppression** [spec] same spec: "Automatic gain control is often desirable on the input signal recorded by the microphone." and "Noise suppression is often desirable on the input signal recorded by the microphone."
- **OpenAI's browser sample uses getUserMedia** [docs] https://developers.openai.com/api/docs/guides/realtime-conversations.md: "Audio input to the model is collected using audio devices ([`getUserMedia`]), and media streams are added as tracks to the peer connection." Audio output "is delivered to your client as a [remote media stream]". This puts agent audio on the peer-connection path that the `"remote-only"` AEC mode targets.

---

## 5. Cloudflare Realtime (SFU, RealtimeKit), relevant to voice agents

### Takeaway

As of November 2026, Cloudflare's Realtime SFU has a generally available **WebSocket adapter**. The adapter bridges WebRTC tracks to a WebSocket service as 48 kHz stereo PCM, so an AI backend can consume or produce audio without implementing a WebRTC peer. Cloudflare's reference "AI audio pipelines" example is a chained STT/TTS design using Workers AI and Durable Objects, and it is marked experimental. RealtimeKit's "Agent Participant" connects a backend over WebSocket to receive transcripts and presence. Working with meeting media is "planned", not available.

### Cited Findings

- **Adapter purpose and status** [docs] https://developers.cloudflare.com/realtime/sfu/features/media-transport-adapters/index.md: "Media transport adapters connect WebRTC tracks to services that exchange media over another transport." Also: "An external service can process or generate audio without implementing a WebRTC peer." And: "The WebSocket adapter is generally available. Each adapter carries one track in one direction."
- **Format** [docs] https://developers.cloudflare.com/realtime/sfu/features/media-transport-adapters/websocket-adapter/index.md: "| Audio into the SFU (`location: "local"`) | WebSocket service → SFU → WebRTC | 48 kHz stereo PCM input, published as Opus audio |" and "PCM payloads use signed 16-bit little-endian samples at 48 kHz, stereo, with left and right samples interleaved."
- **AI audio example** [docs] https://developers.cloudflare.com/realtime/sfu/examples/ai-audio/index.md: "Use the `ai-tts-stt` example to connect speech-to-text and text-to-speech services to WebRTC audio." Also: "The browser uses WebRTC for audio and an application WebSocket for transcription results." And: "The example is experimental."
- **Agent Participant** [docs] https://developers.cloudflare.com/realtime/realtimekit/agents/index.md: "Agent Participant adds a server-side agent to a RealtimeKit meeting. Any backend that can open a WebSocket — a Cloudflare Worker, a Durable Object, or your own server — can connect to it." And: "Working with meeting media is planned."

---

## What this means for the report (synthesis, not sourced)

1. **The loop runs on events.** A text agent loops request, response, tool call, request. A realtime agent is a long-lived stateful session where VAD events (`speech_started`/`speech_stopped`) start and cancel responses. The client must explicitly send `response.create` after a tool result, on both OpenAI and Gemini, and after MCP results too.
2. **Turn-taking is a tuning surface that text agents lack.** Silence-based VAD (300/500 ms OpenAI defaults, about 800 ms Gemini internal default) trades latency against cutting users off. Semantic VAD and Gemini's hybrid VAD try to beat that trade-off. Push-to-talk avoids it.
3. **Interruption makes the context diverge from what was heard.** Servers generate audio faster than realtime, so unplayed audio must be truncated (`conversation.item.truncate` with `audio_end_ms`, or automatic on WebRTC/SIP). Gemini keeps "only the information already sent to the client", which is not the same as what was *played*. Text agents have no such gap.
4. **Tool calls block by default, and the vendors deal with this differently.** OpenAI Realtime documents no non-blocking flag and relies on spoken preambles. OpenAI moved "talk while working" into a separate product (GPT-Live with delegation). Gemini puts it in the API (`NON_BLOCKING` plus `INTERRUPT`/`WHEN_IDLE`/`SILENT`). Interruption can also cancel pending calls: Gemini discards them.
5. **The transport choice follows from the specs.** Browsers use WebRTC (UDP/SRTP/ICE, Opus, built-in AEC, playback tracked by the server). Servers use WebSocket (TCP, base64 PCM in JSON, the client tracks playback and must truncate). Gemini is WebSocket-only unless you add a partner SFU. AEC is the guard against the agent barging in on itself.
6. **Anthropic has no realtime or audio API** (as of 2026-11-19). A Claude-based voice agent must be chained (external STT and TTS around Messages API calls), or Claude must sit behind a voice front-end as a delegated backend (GPT-Live client delegation allows "any model, agent harness, or service").
7. **Sessions are bounded** (OpenAI 60 min; Gemini 15 min audio-only and about 10 min per connection without compression or resumption). Long voice agents therefore need reconnect and state-carryover logic that text agents usually lack.

---

## Sources saved (filename -> URL)

All files are in the session scratchpad `u20/sources/`. Every fetch returned HTTP 200.

OpenAI
- `openai-llms.txt` -> https://developers.openai.com/api/docs/llms.txt
- `openai-realtime.md` -> https://developers.openai.com/api/docs/guides/realtime.md
- `openai-realtime-conversations.md` -> https://developers.openai.com/api/docs/guides/realtime-conversations.md
- `openai-realtime-vad.md` -> https://developers.openai.com/api/docs/guides/realtime-vad.md
- `openai-realtime-mcp.md` -> https://developers.openai.com/api/docs/guides/realtime-mcp.md
- `openai-realtime-transcription.md` -> https://developers.openai.com/api/docs/guides/realtime-transcription.md
- `openai-voice-webrtc.md` -> https://developers.openai.com/api/docs/guides/voice-webrtc.md
- `openai-realtime-webrtc.md` -> https://developers.openai.com/api/docs/guides/realtime-webrtc.md (identical to voice-webrtc)
- `openai-voice-websockets.md` -> https://developers.openai.com/api/docs/guides/voice-websockets.md
- `openai-realtime-websocket.md` -> https://developers.openai.com/api/docs/guides/realtime-websocket.md (same size as voice-websockets)
- `openai-voice-sip.md` -> https://developers.openai.com/api/docs/guides/voice-sip.md
- `openai-realtime-sip.md` -> https://developers.openai.com/api/docs/guides/realtime-sip.md (same size as voice-sip)
- `openai-voice-server-controls.md` -> https://developers.openai.com/api/docs/guides/voice-server-controls.md
- `openai-voice-agents.md` -> https://developers.openai.com/api/docs/guides/voice-agents.md
- `openai-voice-prompting.md` -> https://developers.openai.com/api/docs/guides/voice-prompting.md
- `openai-voice-latency-cost.md` -> https://developers.openai.com/api/docs/guides/voice-latency-cost.md
- `openai-async-tool-calling.md` -> https://developers.openai.com/api/docs/guides/async-tool-calling.md
- `openai-audio.md` -> https://developers.openai.com/api/docs/guides/audio.md
- `openai-live.md` -> https://developers.openai.com/api/docs/guides/live.md
- `openai-live-conversations.md` -> https://developers.openai.com/api/docs/guides/live-conversations.md
- `openai-live-delegation.md` -> https://developers.openai.com/api/docs/guides/live-delegation.md
- `openai-live-partner-integrations.md` -> https://developers.openai.com/api/docs/guides/live-partner-integrations.md
- `openai-text-to-speech.md` -> https://developers.openai.com/api/docs/guides/text-to-speech.md
- `openai-transcription.md` -> https://developers.openai.com/api/docs/guides/transcription.md
- `openai-pricing.md` -> https://developers.openai.com/api/docs/pricing.md
- `openai-models-all.md` -> https://developers.openai.com/api/docs/models/all.md
- `openai-model-gpt-realtime-2.1.md` -> https://developers.openai.com/api/docs/models/gpt-realtime-2.1.md
- `openai-model-gpt-realtime-2.1-mini.md` -> https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini.md
- `openai-model-gpt-realtime.md` -> https://developers.openai.com/api/docs/models/gpt-realtime.md
- `openai-model-gpt-live-1.md` -> https://developers.openai.com/api/docs/models/gpt-live-1.md
- `openai-model-gpt-4o-mini-tts.md` -> https://developers.openai.com/api/docs/models/gpt-4o-mini-tts.md
- `openai-model-gpt-transcribe.md` -> https://developers.openai.com/api/docs/models/gpt-transcribe.md
- `openai-ref-realtime-client-events.md` -> https://developers.openai.com/api/reference/resources/realtime/client-events.md
- `openai-ref-realtime-server-events.md` -> https://developers.openai.com/api/reference/resources/realtime/server-events.md
- `openai-ref-client-secrets-create.md` -> https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create.md

Google Gemini
- `gemini-llms.txt` -> https://ai.google.dev/gemini-api/docs/llms.txt
- `gemini-live.md` -> https://ai.google.dev/gemini-api/docs/live.md.txt (same content as gemini-live-api.md)
- `gemini-live-api.md` -> https://aistudio.google.com/docs/live-api.md
- `gemini-live-capabilities.md` -> https://aistudio.google.com/docs/live-api/capabilities.md
- `gemini-live-tools.md` -> https://aistudio.google.com/docs/live-api/tools.md
- `gemini-live-session-management.md` -> https://aistudio.google.com/docs/live-api/session-management.md
- `gemini-live-ephemeral-tokens.md` -> https://aistudio.google.com/docs/live-api/ephemeral-tokens.md
- `gemini-live-thinking.md` -> https://aistudio.google.com/docs/live-api/thinking.md
- `gemini-live-best-practices.md` -> https://aistudio.google.com/docs/live-api/best-practices.md
- `gemini-live-get-started-websocket.md` -> https://aistudio.google.com/docs/live-api/get-started-websocket.md
- `gemini-pricing.md` -> https://aistudio.google.com/docs/pricing.md
- `gemini-model-3.8-live.md` -> https://aistudio.google.com/docs/models/gemini-3.8-live.md
- `gemini-model-3.8-live-extended-thinking.md` -> https://aistudio.google.com/docs/models/gemini-3.8-live-extended-thinking.md
- `gemini-model-3.1-flash-live-preview.md` -> https://aistudio.google.com/docs/models/gemini-3.1-flash-live-preview.md
- `gemini-model-2.5-flash-native-audio.md` -> https://aistudio.google.com/docs/models/gemini-2.5-flash-native-audio-preview-12-2025.md
- `gemini-speech-generation.md` -> https://aistudio.google.com/docs/speech-generation.md

Anthropic
- `anthropic-llms.txt` -> https://platform.claude.com/docs/llms.txt
- `anthropic-features-overview.md` -> https://platform.claude.com/docs/en/build-with-claude/overview.md
- `anthropic-models-overview.md` -> https://platform.claude.com/docs/en/about-claude/models/overview.md
- `anthropic-help-voice-mode.html` (+ `anthropic-help-voice-mode.txt`, tag-stripped) -> https://support.claude.com/en/articles/11101966-using-voice-mode-on-claude-mobile-apps

Specs
- `rfc6455.txt` -> https://www.rfc-editor.org/rfc/rfc6455.txt
- `rfc8825.txt` -> https://www.rfc-editor.org/rfc/rfc8825.txt
- `rfc8827.txt` -> https://www.rfc-editor.org/rfc/rfc8827.txt
- `rfc8834.txt` -> https://www.rfc-editor.org/rfc/rfc8834.txt
- `rfc8835.txt` -> https://www.rfc-editor.org/rfc/rfc8835.txt
- `rfc7874.txt` -> https://www.rfc-editor.org/rfc/rfc7874.txt
- `rfc6716.txt` -> https://www.rfc-editor.org/rfc/rfc6716.txt
- `w3c-webrtc.html` (+ `w3c-webrtc.txt`, tag-stripped) -> https://www.w3.org/TR/webrtc/
- `w3c-mediacapture-streams.html` (+ `w3c-mediacapture-streams.txt`, tag-stripped) -> https://www.w3.org/TR/mediacapture-streams/

Cloudflare
- `cloudflare-realtime-llms.txt` -> https://developers.cloudflare.com/realtime/llms.txt
- `cloudflare-sfu-media-transport-adapters.md` -> https://developers.cloudflare.com/realtime/sfu/features/media-transport-adapters/index.md
- `cloudflare-sfu-websocket-adapter.md` -> https://developers.cloudflare.com/realtime/sfu/features/media-transport-adapters/websocket-adapter/index.md
- `cloudflare-sfu-ai-audio.md` -> https://developers.cloudflare.com/realtime/sfu/examples/ai-audio/index.md
- `cloudflare-realtimekit-agents.md` -> https://developers.cloudflare.com/realtime/realtimekit/agents/index.md
