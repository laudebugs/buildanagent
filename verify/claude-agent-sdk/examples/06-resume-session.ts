// Capture a session ID, then resume it: the second request carries the first turn's history.
// Docs: sessions.md "Capture the session ID", "Resume by ID"
import { query } from "@anthropic-ai/claude-agent-sdk";
import { check, collect } from "./lib/collect.ts";

const first = await collect(query({ prompt: "Remember the codeword PELICAN.", options: { maxTurns: 2 } }));
const sessionId = first.result?.session_id;
check(sessionId, "first run returned a session_id");

const second = await collect(query({ prompt: "What was the codeword?", options: { resume: sessionId, maxTurns: 2 } }));
check(second.result?.subtype === "success", "resumed run succeeded");
check(second.result?.session_id === sessionId, "resume keeps the same session_id");
// The mock logs every request; the resumed request must include the first prompt.
const { readFileSync } = await import("node:fs");
const log = process.env.MOCK_LOG ? readFileSync(process.env.MOCK_LOG, "utf8") : "";
check(
  !process.env.MOCK_LOG || /PELICAN/.test(log.trim().split("\n").at(-1) ?? ""),
  "resumed model request contains the earlier turn",
);
