// The names the README's TypeScript blocks use without defining them, for scripts/docs-check.mjs, which type-checks
// each block as a module beside this file. A block's own imports and declarations shadow these.
import type * as gateway from "@buildanagent/gateway";
import type * as harnessRoot from "@buildanagent/harness";
import type * as awsDynamo from "@buildanagent/harness/aws/dynamodb";
import type * as awsScheduler from "@buildanagent/harness/aws/scheduler";
import type * as awsSecrets from "@buildanagent/harness/aws/secrets-manager";
import type * as context from "@buildanagent/harness/context";
import type * as file from "@buildanagent/harness/context/file";
import type * as extensions from "@buildanagent/harness/extensions";
import type * as extensionsNode from "@buildanagent/harness/extensions/node";
import type * as mcp from "@buildanagent/harness/mcp";
import type * as memory from "@buildanagent/harness/memory";
import type * as memoryNode from "@buildanagent/harness/memory/node";
import type * as permissions from "@buildanagent/harness/permissions";
import type * as sandbox from "@buildanagent/harness/sandbox";
import type * as server from "@buildanagent/harness/server";
import type * as sessions from "@buildanagent/harness/session";
import type * as jsonl from "@buildanagent/harness/session/jsonl";
import type * as telemetry from "@buildanagent/harness/telemetry";
import type * as tools from "@buildanagent/harness/tools";
import type * as protocol from "@buildanagent/protocol";
import type * as sdk from "@buildanagent/sdk";

declare global {
  type AgentEvent = sdk.AgentEvent;
  type McpEgressFetch = mcp.McpEgressFetch;
  type Extension = extensions.Extension;
  type Log = { store: sessions.SessionStore; index: sessions.SessionIndex; lock: sessions.SessionLock };
  type Model = gateway.Model;
  type PurgeMark = sessions.PurgeMark;
  type ToolRegistry = tools.ToolRegistry;

  type AwsClients = {
    dynamo: import("@aws-sdk/client-dynamodb").DynamoDBClient;
    scheduler: import("@aws-sdk/client-scheduler").SchedulerClient;
    secrets: import("@aws-sdk/client-secrets-manager").SecretsManagerClient;
  };
  type AwsNames = { table: string; runnerArn: string; schedulerRoleArn: string; keySecretId: string };
  type SessionKey = sessions.SessionKey;
  const awsSeams: (
    clients: AwsClients,
    names: AwsNames,
  ) => {
    store: sessions.SessionStore;
    lock: sessions.SessionLock;
    scheduler: sessions.Scheduler;
    keys: import("@buildanagent/agent-safety").KeyStore;
  };
  const dynamoStore: typeof awsDynamo.dynamoStore;
  const dynamoLock: typeof awsDynamo.dynamoLock;
  const eventBridgeScheduler: typeof awsScheduler.eventBridgeScheduler;
  const deliverWake: typeof awsScheduler.deliverWake;
  const secretsManagerKeyStore: typeof awsSecrets.secretsManagerKeyStore;
  const clearPurgeMarks: typeof memory.clearPurgeMarks;
  const composeExtensions: typeof extensions.composeExtensions;
  const createApprovals: typeof sessions.createApprovals;
  const contextFiles: typeof extensionsNode.contextFiles;
  const discoverSkills: typeof extensionsNode.discoverSkills;
  const fileMemoryFiles: typeof memoryNode.fileMemoryFiles;
  const fileTrustStore: typeof extensionsNode.fileTrustStore;
  const isHarnessError: typeof harnessRoot.isHarnessError;
  const memoryExtension: typeof memory.memoryExtension;
  const purgeSession: typeof sessions.purgeSession;
  const readPurgeMarks: typeof memory.readPurgeMarks;
  const planFileSource: typeof extensionsNode.planFileSource;
  const projectContext: typeof extensions.projectContext;
  const withPlanConvention: typeof extensions.withPlanConvention;
  const withSkills: typeof extensions.withSkills;
  const builtinTools: typeof tools.builtinTools;
  const createContextPolicy: typeof context.createContextPolicy;
  const createMcpManager: typeof mcp.createMcpManager;
  const memoryMcpPinStore: typeof mcp.memoryMcpPinStore;
  const createPermissionPipeline: typeof permissions.createPermissionPipeline;
  const createDispatcher: typeof server.createDispatcher;
  const createHarness: typeof server.createHarness;
  const createToolRegistry: typeof tools.createToolRegistry;
  const fileSpillStore: typeof file.fileSpillStore;
  const inProcessTransport: typeof server.inProcessTransport;
  const jsonlStore: typeof jsonl.jsonlStore;
  const pruneSessions: typeof jsonl.pruneSessions;
  const recordsOf: typeof extensions.recordsOf;
  const registerExtensionTools: typeof extensions.registerExtensionTools;

  const loggedEntries: protocol.SessionEntry[];
  const projectSpans: typeof telemetry.projectSpans;
  const createBudgetMeter: typeof telemetry.createBudgetMeter;

  const SYSTEM: string;
  const audit: (entry: unknown) => void;
  const client: sandbox.SandboxClient;
  const controller: AbortController;
  const cwd: string;
  const dir: string;
  const harness: server.Harness;
  const index: sessions.SessionIndex;
  const key: sessions.SessionKey;
  const lock: sessions.SessionLock;
  const machine: sandbox.EscalationMachine;
  const model: Model;
  const policy: sandbox.SandboxPolicy;
  const proxy: tools.FetchProxy;
  const registry: ToolRegistry;
  const requestId: string;
  const session: sessions.Session;
  const spill: context.SpillStore;
  const spillDir: string;
  const store: sessions.SessionStore;
  const system: string;
  const trustFile: string;
  const workspace: string;
}
