// Reads a stream of JSON-RPC messages that arrives in arbitrary chunks, such as a child process's stdout. The framer
// finds the lines, `decode()` checks each message's envelope, and a bad line is reported without stopping the lines
// after it.
import { decode, type FramedMessage, isProtocolError, JsonlFramer, type JsonRpcMessage } from "@buildanagent/protocol";

/** The messages a stream held, and the error code of each line that could not be read, in stream order. */
export interface StreamReading {
  readonly messages: JsonRpcMessage[];
  readonly refused: string[];
}

// #region read
/** Reads every line of `chunks`, which may cut a line, or a character, at any byte. */
export function readStream(chunks: Iterable<Uint8Array>): StreamReading {
  const framer = new JsonlFramer();
  const reading: StreamReading = { messages: [], refused: [] };

  function take(results: FramedMessage[]): void {
    for (const result of results) {
      if (!result.ok) {
        reading.refused.push(result.error.code);
        continue;
      }
      // decode() reads a string as JSON text, so a line that parsed to a string would be parsed a second time.
      if (typeof result.value === "string") {
        reading.refused.push("invalid_request");
        continue;
      }
      try {
        reading.messages.push(decode(result.value));
      } catch (error) {
        if (!isProtocolError(error)) throw error;
        reading.refused.push(error.code);
      }
    }
  }

  for (const chunk of chunks) take(framer.push(chunk));
  take(framer.end());
  return reading;
}
// #endregion
