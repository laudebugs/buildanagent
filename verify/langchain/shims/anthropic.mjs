// Stands in for @langchain/anthropic during doc-example runs: same exports, scripted chat models.
import { ScriptedChatModel } from "../scripts/scripted-model.mjs";

export * from "@langchain/anthropic";
export class ChatAnthropic extends ScriptedChatModel {}
