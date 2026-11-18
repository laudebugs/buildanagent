// generateText returns the model's text and usage; `instructions` reach the model as a system
// message, and a system message inside `messages` is rejected unless allowSystemInMessages is set.
// Docs: ai-sdk-core/generating-text.mdx, reference/ai-sdk-core/generate-text.mdx
import { generateText, InvalidPromptError } from "ai";
import { check, scripted, systemText } from "./lib/check.ts";

{
  const { model, requests } = scripted(["Hello from the mock."]);
  const result = await generateText({ model, instructions: "You are terse.", prompt: "Say hello." });
  check(result.text === "Hello from the mock.", "result.text is the model's answer");
  check(result.steps.length === 1, "one step without tools");
  check(result.finishReason === "stop", "finishReason is 'stop'");
  check(result.usage.inputTokens === 10 && result.usage.outputTokens === 5, "usage reports input and output tokens");
  check(systemText(requests[0]) === "You are terse.", "instructions arrive as the system message");
}

// The OpenAI provider page shows a system message inside `messages` without the opt-in (F-finding).
{
  const { model } = scripted(["unused"]);
  let error: unknown;
  try {
    await generateText({
      model,
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Tell me a joke." },
      ],
    });
  } catch (e) {
    error = e;
  }
  check(InvalidPromptError.isInstance(error), "a system message in `messages` throws InvalidPromptError by default");

  const ok = await generateText({
    model: scripted(["A joke."]).model,
    allowSystemInMessages: true,
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Tell me a joke." },
    ],
  });
  check(ok.text === "A joke.", "allowSystemInMessages: true accepts it");
}
