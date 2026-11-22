// Decides whether a realtime source would open a real connection, so the runner must skip it. Fail closed: a source
// that might connect is skipped, and a false skip costs only a missing run, while a false run could reach the real
// OpenAI Realtime API (our own examples run without the network-blocking preload).
// A realtime source runs only when all of these hold:
// - it names no real transport (a class or a 'websocket', 'webrtc' or 'sip' string) anywhere, comments included;
// - it imports `@openai/agents-realtime/testing` in a real import statement, not a comment;
// - every `new RealtimeSession(` passes a `transport` that is an identifier initialised from
//   `new ScriptedRealtimeTransport(`, because a session built with no transport, or with a string, opens a WebSocket
//   or WebRTC connection (`RealtimeSession`'s constructor in `@openai/agents-realtime`);
// - it neither renames `RealtimeSession` nor loads modules dynamically, which this simple scan could not follow.
const REALTIME = /@openai\/agents\/realtime|RealtimeSession|RealtimeAgent/;
const REAL_TRANSPORT = /OpenAIRealtime(?:WebRTC|WebSocket|SIP)|["'`](?:websocket|webrtc|sip)["'`]/i;
const TESTING_IMPORT = /^\s*import\b[^;]*?\bfrom\s*["']@openai\/agents-realtime\/testing["']/m;

/** The code with block and line comments removed; a `//` inside a string may cut a line, which only skips more. */
export const withoutComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

/** The text between the parentheses that open at `start`, or undefined when they never close. */
function argsAt(code, start) {
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    if (code[i] === "(") depth++;
    if (code[i] === ")" && --depth === 0) return code.slice(start + 1, i);
  }
  return undefined;
}

/** True when every `new RealtimeSession(` hands its options a scripted transport held in an identifier. */
function sessionsUseScriptedTransport(code) {
  for (const match of code.matchAll(/new\s+RealtimeSession\s*\(/g)) {
    const args = argsAt(code, match.index + match[0].length - 1);
    const transport = args === undefined ? null : /\btransport\b(?:\s*:\s*([A-Za-z_$][\w$]*)\s*(?=[,}]))?/.exec(args);
    const name = transport && (transport[1] ?? "transport");
    const declared =
      name &&
      new RegExp(`\\b(?:const|let)\\s+${name.replace(/\$/g, "\\$&")}\\s*=\\s*new\\s+ScriptedRealtimeTransport\\s*\\(`);
    if (!declared?.test(code)) return false;
  }
  return true;
}

/** True when a source must be skipped because it names, or might open, a real realtime connection. */
export function realtimeNeedsConnection(code) {
  if (!REALTIME.test(code)) return false;
  if (REAL_TRANSPORT.test(code)) return true;
  const stripped = withoutComments(code);
  if (!TESTING_IMPORT.test(stripped)) return true;
  if (/\bRealtimeSession\s+as\b|\bimport\s*\(|\brequire\s*\(|import\s*\*\s*as/.test(stripped)) return true;
  return !sessionsUseScriptedTransport(stripped);
}
