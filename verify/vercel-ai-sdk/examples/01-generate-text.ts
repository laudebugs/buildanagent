// generateText returns the model's text and usage; `instructions` reach the model as a system
// message, and a system message inside `messages` is rejected unless allowSystemInMessages is set.
// Docs: ai-sdk-core/generating-text.mdx, reference/ai-sdk-core/generate-text.mdx
import { generateText, InvalidPromptError } from "ai";
import { check, scripted, systemText } from "./lib/check.ts";

{
  // #region call
  const { model, requests } = scripted(["Hello from the mock."]); // book:note mock
  const result = await generateText({
    model,
    instructions: "You are terse.", // book:note request
    prompt: "Say hello.",
  });
  check(result.text === "Hello from the mock.", "result.text is the model's answer");
  check(result.steps.length === 1, "one step without tools");
  check(result.finishReason === "stop", "finishReason is 'stop'"); // book:note finish
  check(result.usage.inputTokens === 10 && result.usage.outputTokens === 5, "usage reports input and output tokens");
  check(systemText(requests[0]) === "You are terse.", "instructions arrive as the system message");
  // #endregion
}

// The OpenAI provider page shows a system message inside `messages` without the opt-in (F-finding).
{
  // #region system-in-messages
  const { model } = scripted(["unused"]);
  let error: unknown;
  try {
    await generateText({
      model,
      messages: [
        { role: "system", content: "You are a helpful assistant." }, // book:note system-role
        { role: "user", content: "Tell me a joke." },
      ],
    });
  } catch (e) {
    error = e; // book:note rejected
  }
  check(InvalidPromptError.isInstance(error), "a system message in `messages` throws InvalidPromptError by default");

  const ok = await generateText({
    model: scripted(["A joke."]).model,
    allowSystemInMessages: true, // book:note opt-in
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Tell me a joke." },
    ],
  });
  check(ok.text === "A joke.", "allowSystemInMessages: true accepts it");
  // #endregion
}
