// output: Output.object({ schema }) asks for JSON, parses it, and types result.output. A response
// that fails the schema rejects with NoObjectGeneratedError; reading result.output when the last
// step ended on tool calls throws NoOutputGeneratedError. Output.object takes `name` and
// `description`, not `schemaName`. Docs: ai-sdk-core/generating-structured-data.mdx,
// reference/ai-sdk-core/output.mdx
import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output, tool } from "ai";
import { z } from "zod";
import { check, scripted } from "./lib/check.ts";

// #region schema
const schema = z.object({ category: z.enum(["billing", "bug", "other"]), urgent: z.boolean() });
// #endregion

{
  const { model, requests } = scripted([JSON.stringify({ category: "billing", urgent: true })]);
  // #region output-object
  const result = await generateText({
    model,
    output: Output.object({ schema, name: "triage", description: "Ticket triage" }), // book:note output
    prompt: "I was charged twice!",
  });
  const out: { category: "billing" | "bug" | "other"; urgent: boolean } = result.output; // book:note typed
  // #endregion
  check(out.category === "billing" && out.urgent, "result.output is the parsed, typed object");
  const fmt = requests[0].responseFormat;
  check(fmt?.type === "json" && fmt.name === "triage", "the request asks for JSON with the schema's name");
  check(JSON.stringify(fmt?.schema).includes('"urgent"'), "the request carries the JSON Schema");
}
{
  const { model } = scripted([JSON.stringify({ category: "refund" })]);
  let error: unknown;
  try {
    await generateText({ model, output: Output.object({ schema }), prompt: "?" });
  } catch (e) {
    error = e;
  }
  check(
    NoObjectGeneratedError.isInstance(error),
    "a response that fails the schema rejects with NoObjectGeneratedError",
  );
}
{
  const lookup = tool({ inputSchema: z.object({}), execute: async () => "x" });
  const { model } = scripted([{ tools: [{ name: "lookup", input: {} }] }]);
  const result = await generateText({ model, tools: { lookup }, output: Output.object({ schema }), prompt: "?" });
  let error: unknown;
  try {
    void result.output;
  } catch (e) {
    error = e;
  }
  check(
    NoOutputGeneratedError.isInstance(error),
    "result.output throws NoOutputGeneratedError when the last step ended on tool calls",
  );
}
