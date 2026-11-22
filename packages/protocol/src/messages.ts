/**
 * The harness protocol's messages: the client's commands, the server's requests and notifications, and the results that
 * answer them. Every message is JSON-RPC 2.0 and carries `"jsonrpc": "2.0"`. These types are the contract, and
 * `schema/protocol.schema.json` is generated from a mirror of them for clients in other languages.
 */
import type { ContentBlock, ModelContent } from "@buildanagent/gateway";
import type { AgentEvent, Resolution, SignedPendingRequest } from "@buildanagent/sdk";
import type { SessionEntry, TurnEndEntry } from "./entries.js";

/** A request id: a number or a string. A response carries the id of the request it answers. */
export type Id = number | string;

/** Who a client says it is, in `initialize`. */
export interface ClientInfo {
  name: string;
  version: string;
}

/** What a client sends. A command with an `id` gets one response, and `$/cancelRequest` has none. */
export type ClientCommand =
  | {
      jsonrpc: "2.0";
      id: Id;
      method: "initialize";
      params: { clientInfo: ClientInfo; capabilities: string[] };
    }
  | { jsonrpc: "2.0"; id: Id; method: "session/create"; params: { session?: string; cwd: string } }
  | {
      jsonrpc: "2.0";
      id: Id;
      method: "session/open";
      params: {
        session?: string;
        cwd: string;
        /**
         * Replays the session's entries from this sequence number on, as `entry_appended` events, before any live event.
         * A client that last saw `seq` N sends N + 1. A value past the log's end is refused with `InvalidParams`.
         */
        fromSeq?: number;
      };
    }
  | { jsonrpc: "2.0"; id: Id; method: "session/list"; params: { cursor?: string } }
  | {
      jsonrpc: "2.0";
      id: Id;
      method: "turn/start";
      params: { session: string; input: ContentBlock[] };
      /** A trace context, `traceparent` style, so the turn's spans join the client's trace. */
      trace?: string;
    }
  | {
      jsonrpc: "2.0";
      id: Id;
      method: "turn/steer" | "turn/followUp";
      params: { session: string; input: ContentBlock[] };
    }
  | { jsonrpc: "2.0"; id: Id; method: "turn/interrupt"; params: { session: string; reason?: string } }
  | { jsonrpc: "2.0"; id: Id; method: "approval/list"; params: { session: string } }
  /** Experimental: a client opts in by listing the method name in its `initialize` capabilities, or the server answers `NotOptedIn`. */
  | {
      jsonrpc: "2.0";
      id: Id;
      method: "session/checkout" | "session/fork";
      params: { session: string; entryId: string };
    }
  /**
   * Withdraws one of the client's own requests by id. A cancelled `turn/start` aborts its turn, which still ends with
   * `turn/settled`; any other request may still be answered as usual.
   */
  | { jsonrpc: "2.0"; method: "$/cancelRequest"; params: { id: Id } };

/** The server's answer to `initialize`. */
export interface InitializeResult {
  serverInfo: { name: string; version: string; sdkVersion: string; specVersion: "v1" };
  /** The SDK's capabilities from `run_start`, plus the harness's own. */
  capabilities: string[];
  /** The methods a client must opt into, by listing each method name in the `capabilities` of its `initialize`. */
  experimental: string[];
  /** The requests still waiting for an answer, re-armed for a client that joins. */
  pending: { session: string; request: SignedPendingRequest }[];
}

/** The answer to a turn command: the server took it, or why it did not. */
export type Disposition = { accepted: true; turn: string } | { accepted: false; reason: "busy" | "locked" | "invalid" };

/** The answer to `session/create` and `session/open`. `head` is the entry the session's HEAD points at, or `null` for a new one. */
export interface SessionOpened {
  session: string;
  head: string | null;
}

/** One session in `session/list`. */
export interface SessionListItem {
  session: string;
  startedAt: string;
  lastEntryAt: string;
  entryCount: number;
}

/** The answer to `session/list`. A `nextCursor` means more sessions follow. */
export interface SessionList {
  sessions: SessionListItem[];
  nextCursor?: string;
}

/** The answer to `turn/interrupt`: whether a turn was running to interrupt. */
export interface InterruptResult {
  interrupted: boolean;
}

/** The answer to `approval/list`. */
export interface ApprovalList {
  pending: SignedPendingRequest[];
}

/** The answer to `session/checkout` and `session/fork`: the session now in use and its HEAD. */
export interface BranchResult {
  session: string;
  head: string;
}

/** The result of each client method, by method name. */
export interface ClientResultMap {
  initialize: InitializeResult;
  "session/create": SessionOpened;
  "session/open": SessionOpened;
  "session/list": SessionList;
  "turn/start": Disposition;
  "turn/steer": Disposition;
  "turn/followUp": Disposition;
  "turn/interrupt": InterruptResult;
  "approval/list": ApprovalList;
  "session/checkout": BranchResult;
  "session/fork": BranchResult;
}

/** What a server request's client answer holds, by method name. */
export interface ServerResultMap {
  "approval/request": { resolutions: Resolution[] };
  "clarification/request": { resolutions: Resolution[] };
  "tool/call": { content: ModelContent[]; isError: boolean };
}

/** A JSON-RPC error object. `code` is one of `ErrorCodes` or a code an extension defines. */
export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** A response: the result of one request, or an error. An error to a message whose id could not be read has id `null`. */
export type ResponseMessage<Result> =
  | { jsonrpc: "2.0"; id: Id; result: Result }
  | { jsonrpc: "2.0"; id: Id | null; error: RpcError };

/** What the server asks the client for. The client answers with a response carrying the same id. */
export type ServerRequest =
  | {
      jsonrpc: "2.0";
      id: string;
      method: "approval/request";
      params: { session: string; request: SignedPendingRequest; group?: string[] };
    }
  | {
      jsonrpc: "2.0";
      id: string;
      method: "clarification/request";
      params: { session: string; request: SignedPendingRequest };
    }
  | {
      jsonrpc: "2.0";
      id: string;
      method: "tool/call";
      params: { session: string; callId: string; tool: string; input: unknown };
    };

/** How a turn ended, in `turn/settled`. */
export interface TurnResultSummary {
  stopReason: TurnEndEntry["stopReason"];
  steps: number;
  /** The turn's cost in US dollars, or `null` when a price is unknown. */
  costUsd: number | null;
  error?: { kind: string; message: string };
}

/** What the harness adds to the SDK's events. */
export type HarnessEvent =
  | { type: "entry_appended"; entry: SessionEntry }
  | { type: "budget_warning"; spentUsd: number; capUsd: number }
  | { type: "context_fill"; tokens: number; budget: number }
  | { type: "completion_check"; entry: SessionEntry }
  /**
   * The server dropped `count` events of this session because the client was not taking them fast enough. The
   * notification's `seq` is the last dropped event's. A client recovers the dropped entries with `session/open` and a
   * `fromSeq` one past the last `seq` it received.
   */
  | { type: "events_dropped"; count: number };

/**
 * What the server sends without being asked. `event` carries a sequence number, and every turn ends with `turn/settled`.
 * `$/cancelRequest` withdraws a server request the client has not answered: the server ignores any answer to it after.
 */
export type ServerNotification =
  | { jsonrpc: "2.0"; method: "event"; params: { session: string; seq: number; event: AgentEvent | HarnessEvent } }
  | { jsonrpc: "2.0"; method: "turn/settled"; params: { session: string; turn: string; result: TurnResultSummary } }
  | { jsonrpc: "2.0"; method: "$/cancelRequest"; params: { id: Id } };

/** Everything a client sends: commands, and answers to the server's requests. */
export type ClientMessage = ClientCommand | ResponseMessage<ServerResultMap[keyof ServerResultMap]>;

/** Everything a server sends: answers to commands, requests and notifications. */
export type ServerMessage =
  | ResponseMessage<ClientResultMap[keyof ClientResultMap]>
  | ServerRequest
  | ServerNotification;

/** Any message of the protocol, in either direction. */
export type ProtocolMessage = ClientMessage | ServerMessage;
