// A chained voice pipeline on Cloudflare: speech-to-text, then an ordinary `streamText` loop with one tool inside
// `onTurn`, then text-to-speech, all in one Durable Object that `withVoice(Agent)` wraps. A fake Transcriber turns one
// audio frame into an interim and a final transcript, and a fake TTSProvider returns fixed bytes, so no speech model
// runs. The example drives the Agent over its WebSocket with the voice protocol's messages. Turn 1 asserts that the
// tool ran inside the turn and before any audio was sent, that the user hears the reply as an audio frame, and that
// `turn_metrics` closes the turn. Turn 2 holds the speech on its second sentence, sends `interrupt`, and asserts that
// `context.signal` aborted, the TTS call saw the abort, the signal that `onTurn` handed to `streamText` reached the model
// call aborted, and the status returned to `listening`. What these checks prove: the mixin aborts the signal it gives
// `onTurn` and the TTS provider, and the scripted model receives whatever signal `streamText` was given. What they do not
// prove: that a real model call stops early, because the scripted model ignores its signal. Without `abortSignal` in the
// `streamText` call, every check except the model-signal one still passes, since the mixin aborts its own signal either
// way. The model's request in
// turn 2 holds no tool result from turn 1: the mixin keeps only `{ role, content }` text history, so a tool result
// reaches a later turn only if the agent stores it itself.
// `agents/voice` is experimental at `agents` 0.33.0 as of November 2026: the docs say it "will break between releases".
// Local workerd has no Workers AI speech models, so the speech stages are fakes; Flux, Nova 3 and the Workers AI TTS
// have no local simulation.
// Docs: agents/docs/agents/voice.md ("withVoice", "onTurn", "Lifecycle Hooks", "Turn metrics", "Conversation History").
import { Agent, getAgentByName } from "agents";
import {
  type Transcriber,
  type TranscriberSessionOptions,
  type TTSProvider,
  type VoiceTurnContext,
  withVoice,
} from "agents/voice";
import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import { check, type Harness, rpc, scripted, type Turn } from "./lib/check.ts";

type Env = { Concierge: DurableObjectNamespace<Concierge> };

/** What the fake speech stages hear, say and return. The first byte of an audio frame picks the utterance. */
const UTTERANCES = ["what is the weather in Paris", "and what about tomorrow"];
const INTERIMS = ["what is the", "and what about"];
const SPEECH = new Uint8Array([0x49, 0x44, 0x33, 0x04]).buffer;
const HELD_SENTENCE = "Rain is due on Friday.";

// #region voice-agent
const VoiceAgent = withVoice(Agent);

/** Turns one audio frame into interim and final text, and never calls a speech model. */
class FakeTranscriber implements Transcriber {
  frames = 0;
  closed = 0;
  createSession(options?: TranscriberSessionOptions) {
    return {
      feed: (chunk: ArrayBuffer) => {
        this.frames++;
        const which = new Uint8Array(chunk)[0];
        options?.onInterim?.(INTERIMS[which]);
        options?.onUtterance?.(UTTERANCES[which]);
      },
      close: () => {
        this.closed++;
      },
    };
  }
}

/** Returns fixed bytes; the held sentence waits for the pipeline's abort signal, like speech still playing. */
class FakeTTS implements TTSProvider {
  spoken: string[] = [];
  constructor(private events: string[]) {}
  sawAbort = false;
  async synthesize(text: string, signal?: AbortSignal) {
    this.spoken.push(text);
    this.events.push(`tts:${text}`);
    if (text !== HELD_SENTENCE) return SPEECH;
    // Wait for the abort, but settle at once when there is no signal or it has already aborted.
    if (signal && !signal.aborted) {
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })); // book:note hold
    }
    this.sawAbort = signal?.aborted ?? false;
    return null;
  }
}

const script: Turn[] = [
  { tools: [{ name: "get_forecast", input: { city: "Paris" } }] },
  "It is 21 degrees and sunny in Paris.",
  `Tomorrow looks dry across the region. ${HELD_SENTENCE}`,
];

export class Concierge extends VoiceAgent<Env> {
  override transcriber = new FakeTranscriber();
  mock = scripted(script);
  events: string[] = []; // onTurn, tool and TTS calls in the order they happened
  override tts = new FakeTTS(this.events);
  turnSignals: AbortSignal[] = [];
  interrupts = 0;

  override async onTurn(heard: string, context: VoiceTurnContext) {
    this.events.push(`onTurn:${heard}`);
    this.turnSignals.push(context.signal); // book:note signal
    const result = streamText({
      model: this.mock.model,
      system: "You are a voice assistant. Keep answers to one or two sentences.",
      // The history holds `{ role, content }` text only, so turn 1's tool call and result are not in it.
      messages: [...context.messages, { role: "user", content: heard }],
      tools: {
        get_forecast: tool({
          description: "Look up today's forecast for a city",
          inputSchema: z.object({ city: z.string() }),
          execute: async ({ city }) => {
            this.events.push(`tool:${city}`);
            return { city, tempC: 21, sky: "sunny" };
          },
        }),
      },
      stopWhen: stepCountIs(3),
      abortSignal: context.signal,
    });
    return result.fullStream; // book:note stream
  }

  override onInterrupt() {
    this.interrupts++;
  }
  // #endregion voice-agent

  /** Synchronous reads for the test, as plain data a Durable Object RPC can return. */
  snapshot() {
    const requests = this.mock.requests.map((r) => ({
      modelSignalAborted: r.abortSignal?.aborted, // undefined: the call got no abort signal
      roles: r.prompt.map((m) => m.role),
      toolOutputs: r.prompt.flatMap((m) =>
        m.role === "tool" ? m.content.map((p) => (p.type === "tool-result" ? JSON.stringify(p.output) : "")) : [],
      ),
    }));
    return {
      events: [...this.events],
      spoken: this.tts.spoken,
      requests,
      signalsAborted: this.turnSignals.map((s) => s.aborted),
      ttsSawAbort: this.tts.sawAbort,
      interrupts: this.interrupts,
      frames: this.transcriber.frames,
      history: this.getConversationHistory(),
    };
  }
}

type Message = { type: string; [key: string]: unknown };

export async function test(env: Env, h: Harness) {
  const agent = rpc<Concierge>(await getAgentByName(env.Concierge, "line-1"));
  const res = await agent.fetch("http://localhost/", { headers: { Upgrade: "websocket" } });
  const ws = (res as unknown as { webSocket: WebSocket }).webSocket;
  check(ws, "a client connects to the voice agent over WebSocket");
  ws.binaryType = "arraybuffer"; // without it, audio arrived as a Blob in our harness
  ws.accept();

  /** Every message the agent sent, in order: JSON messages as objects, audio as ArrayBuffers. */
  const inbox: (Message | ArrayBuffer)[] = [];
  ws.addEventListener("message", (e) => {
    inbox.push(typeof e.data === "string" ? JSON.parse(e.data) : (e.data as ArrayBuffer));
  });
  const messages = () => inbox.filter((m): m is Message => !(m instanceof ArrayBuffer));
  const frames = () => inbox.filter((m): m is ArrayBuffer => m instanceof ArrayBuffer);
  const statuses = () =>
    messages()
      .filter((m) => m.type === "status")
      .map((m) => m.status);
  const send = (message: Message) => ws.send(JSON.stringify(message));

  check(await h.until(() => messages().some((m) => m.type === "welcome"), 5000), "the server sent a welcome message");
  check(
    messages().find((m) => m.type === "welcome")?.protocol_version === 1,
    "the server opens with a welcome message that carries protocol version 1",
  );

  send({ type: "start_call" });
  check(await h.until(() => statuses().includes("listening"), 5000), "start_call brought the status to listening");
  check(
    messages().some((m) => m.type === "audio_config" && m.format === "mp3"),
    "start_call is answered with an audio_config message, mp3 by default",
  );

  // Turn 1: one audio frame in, an interim and a final transcript, a tool, spoken audio and turn metrics out.
  ws.send(new Uint8Array([0, 0, 0, 0]).buffer);
  check(
    await h.until(() => messages().some((m) => m.type === "turn_metrics"), 5000),
    "turn 1 ended with a turn_metrics message",
  );
  const interims = messages().filter((m) => m.type === "transcript_interim" && m.text);
  const userFinal = messages().find((m) => m.type === "transcript" && m.role === "user");
  check(
    interims.length === 1 && interims[0].text === INTERIMS[0],
    "an interim transcript arrives, with the text the fake transcriber gave",
  );
  check(userFinal?.text === UTTERANCES[0], "a final transcript arrives for the user, with the utterance's text");
  check(
    messages().findIndex((m) => m.type === "transcript_interim" && m.text) <
      messages().findIndex((m) => m.type === "transcript" && m.role === "user"),
    "the interim transcript comes before the final one",
  );

  const first = await agent.snapshot();
  check(first.frames === 1, "the transcriber received exactly the one audio frame the client sent");
  check(
    first.events.join(" | ") === `onTurn:${UTTERANCES[0]} | tool:Paris | tts:It is 21 degrees and sunny in Paris.`,
    `the tool ran inside the turn, after onTurn started and before the reply was synthesized: ${first.events.join(" | ")}`,
  );
  check(
    first.requests.length === 2 && first.requests[1].toolOutputs.some((o) => o.includes('"tempC":21')),
    "the model's second step in the same turn saw the tool result",
  );
  check(frames().length === 1, "one audio frame followed the reply");
  check(
    new Uint8Array(frames()[0]).join() === new Uint8Array(SPEECH).join(),
    "the audio frame holds the fake TTS provider's bytes",
  );
  const metrics = messages().find((m) => m.type === "turn_metrics");
  check(
    metrics?.outcome === "completed" && metrics.source === "speech" && typeof metrics.turnTotalMs === "number",
    "turn_metrics reports a completed turn that began as speech, with a total duration",
  );
  check(
    typeof metrics?.finalInputToFirstAudioMs === "number",
    "turn_metrics holds the final-input-to-first-audio latency, which a sent audio frame makes measurable",
  );
  check(first.signalsAborted.join() === "false", "the signal onTurn received stayed live while the turn completed");
  check(statuses().at(-1) === "listening", "the status returned to listening after the reply");

  // Turn 2: the reply's second sentence is held, so the agent is speaking when the client interrupts.
  const mark = inbox.length;
  ws.send(new Uint8Array([1, 0, 0, 0]).buffer);
  check(
    await h.until(
      () =>
        inbox.slice(mark).some((m) => !(m instanceof ArrayBuffer) && m.type === "status" && m.status === "speaking"),
      5000,
    ),
    "turn 2 reached the speaking status",
  );
  check(
    await h.until(async () => (await agent.snapshot()).spoken.includes(HELD_SENTENCE), 5000),
    "the TTS call for the held sentence started",
  );
  const speaking = await agent.snapshot();
  check(frames().length === 2, "the first sentence of turn 2 reached the client as audio while it was speaking");
  check(
    speaking.signalsAborted.join() === "false,false" && speaking.interrupts === 0,
    "before the interrupt, no turn signal is aborted and onInterrupt has not run",
  );
  const speakingStatuses = statuses().length;
  send({ type: "interrupt" });
  check(
    await h.until(() => statuses().length > speakingStatuses && statuses().at(-1) === "listening", 5000),
    "the interrupt brought a new listening status",
  );
  check(
    await h.until(() => messages().filter((m) => m.type === "turn_metrics").length === 2, 5000),
    "the interrupted turn ended with its own turn_metrics message",
  );

  const after = await agent.snapshot();
  check(
    after.signalsAborted.join() === "false,true",
    "the interrupt aborted turn 2's context.signal and left turn 1's alone",
  );
  check(after.ttsSawAbort, "the TTS call that was speaking saw the same abort");
  check(
    after.requests[2].modelSignalAborted === true && after.requests[0].modelSignalAborted === false,
    "the signal passed to streamText reached the model call: aborted for turn 2, live for turn 1",
  );
  check(after.interrupts === 1, "onInterrupt ran once");
  check(statuses().at(-1) === "listening", "the status returned to listening after the interrupt");
  check(
    messages()
      .filter((m) => m.type === "turn_metrics")
      .at(-1)?.outcome === "aborted",
    "the interrupted turn closed with a turn_metrics outcome of aborted",
  );

  // A tool result from one turn reaches the next only if the agent stores it.
  const turn2 = after.requests[2];
  check(!turn2.roles.includes("tool"), "turn 2's model request holds no tool message from turn 1");
  check(turn2.toolOutputs.length === 0, "and no tool result");
  check(
    after.history.map((m) => m.role).join() === "user,assistant,user",
    `the stored history is text only: ${JSON.stringify(after.history)}`,
  );
  ws.close();
}
