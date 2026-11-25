// The harness's state on AWS: a DynamoDB table holds the session log and its lock, EventBridge Scheduler wakes the
// runner, and Secrets Manager holds the approval key ring. The host makes the three AWS SDK clients and hands them in,
// so the adapters never read credentials themselves. A Lambda function exports `handler` and receives each wake.
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { SchedulerClient } from "@aws-sdk/client-scheduler";
import type { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { dynamoLock, dynamoStore } from "@buildanagent/harness/aws/dynamodb";
import { deliverWake, eventBridgeScheduler } from "@buildanagent/harness/aws/scheduler";
import { secretsManagerKeyStore } from "@buildanagent/harness/aws/secrets-manager";
import type { SessionKey } from "@buildanagent/harness/session";

/** The AWS SDK clients the host makes, with its own credentials and region. */
export interface AwsClients {
  readonly dynamo: DynamoDBClient;
  readonly scheduler: SchedulerClient;
  readonly secrets: SecretsManagerClient;
}

/** The names the deployment gives the adapters, such as from the function's environment variables. */
export interface AwsNames {
  readonly table: string;
  readonly runnerArn: string;
  readonly schedulerRoleArn: string;
  readonly keySecretId: string;
}

// #region seams
export function awsSeams(clients: AwsClients, names: AwsNames) {
  return {
    store: dynamoStore(clients.dynamo, { tableName: names.table }),
    lock: dynamoLock(clients.dynamo, { tableName: names.table }),
    scheduler: eventBridgeScheduler(clients.scheduler, { targetArn: names.runnerArn, roleArn: names.schedulerRoleArn }),
    keys: secretsManagerKeyStore(clients.secrets, { secretId: names.keySecretId }),
  };
}
// #endregion

// A wake names one id, so the runner packs the user and the session into it and unpacks them when the wake arrives.
export const wakeId = (key: SessionKey) => JSON.stringify([key.userId, key.sessionId]);

// #region handler
export function wakeHandler(seams: ReturnType<typeof awsSeams>, resume: (key: SessionKey) => Promise<void>) {
  return (event: unknown) =>
    deliverWake(event, async (id) => {
      const [userId, sessionId] = JSON.parse(id) as [string, string];
      const lock = await seams.lock.acquire({ userId, sessionId });
      // Another invocation holds the session, so this wake is a duplicate and has nothing to do.
      if (lock === "would_block") return;
      try {
        await resume({ userId, sessionId });
      } finally {
        await lock.release();
      }
    });
}
// #endregion
