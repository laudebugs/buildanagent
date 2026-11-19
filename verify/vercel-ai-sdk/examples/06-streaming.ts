// streamText returns at once; result.textStream yields the text as it arrives, result.stream
// yields typed parts (text-delta parts carry `text`, not `textDelta`), and the promised
// result.text resolves when the stream ends. Docs: ai-sdk-core/generating-text.mdx ("streamText")
import { streamText } from "ai";
import { check, scripted } from "./lib/check.ts";

{
  // #region text-stream
  const { model } = scripted(["Streams arrive in pieces."]);
  const result = streamText({ model, prompt: "Stream something." }); // book:note returns-at-once
  const chunks: string[] = [];
  for await (const chunk of result.textStream) chunks.push(chunk); // book:note deltas
  // #endregion
  check(chunks.length > 1, `textStream yields several chunks (${chunks.length})`);
  check(chunks.join("") === "Streams arrive in pieces.", "the chunks join to the full text");
  check((await result.text) === "Streams arrive in pieces.", "result.text resolves to the full text");
  check((await result.finishReason) === "stop", "result.finishReason resolves after the stream");
}
{
  const { model } = scripted(["Typed parts."]);
  // #region stream-parts
  const result = streamText({ model, prompt: "Stream something." });
  const types = new Set<string>();
  let text = "";
  for await (const part of result.stream) {
    types.add(part.type);
    if (part.type === "text-delta") text += part.text;
  }
  // #endregion
  check(
    ["start", "start-step", "text-delta", "finish-step", "finish"].every((t) => types.has(t)),
    "result.stream yields lifecycle and text-delta parts",
  );
  check(text === "Typed parts.", "text-delta parts carry the text in `text`");
}
{
  let ended = false;
  const { model } = scripted(["Done."]);
  const result = streamText({
    model,
    prompt: "x",
    onEnd: () => {
      ended = true;
    },
  });
  await result.consumeStream();
  check(ended, "onEnd fires once the stream is consumed");
}
