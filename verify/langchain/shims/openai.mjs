// Stands in for @langchain/openai during doc-example runs: same exports, scripted chat models.
import { ScriptedChatModel } from "../scripts/scripted-model.mjs";

export * from "@langchain/openai";
export class ChatOpenAI extends ScriptedChatModel {}
export class AzureChatOpenAI extends ScriptedChatModel {}
