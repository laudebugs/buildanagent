// An in-process Secrets Manager for the key store's offline tests. It takes the SDK's real GetSecretValueCommand and
// answers from versions the test puts, each with its staging labels, the way the service keeps AWSCURRENT and
// AWSPREVIOUS: putting a value moves AWSCURRENT to it and AWSPREVIOUS to the version that was current. It can fail the
// next read with an error whose message quotes the request, as a careless SDK error might.
import {
  GetSecretValueCommand,
  type GetSecretValueCommandInput,
  ResourceNotFoundException,
  type SecretsManagerClient,
  SecretsManagerServiceException,
} from "@aws-sdk/client-secrets-manager";

interface Version {
  readonly id: string;
  readonly value: { readonly SecretString?: string; readonly SecretBinary?: Uint8Array };
  stages: string[];
}

/** The fake, the client the store takes, and the means to put values and inject a failure. */
export function fakeSecretsManager() {
  const secrets = new Map<string, Version[]>();
  const failures: Error[] = [];
  const sent: { readonly operation: string; readonly input: GetSecretValueCommandInput }[] = [];
  let next = 0;
  const client = {
    async send(command: { constructor: { name: string }; input: GetSecretValueCommandInput }) {
      sent.push({ operation: command.constructor.name.replace(/Command$/, ""), input: command.input });
      if (command.constructor.name !== GetSecretValueCommand.name) {
        throw new Error(`the fake Secrets Manager does not implement ${command.constructor.name}`);
      }
      const failure = failures.shift();
      if (failure !== undefined) throw failure;
      const stage = command.input.VersionStage ?? "AWSCURRENT";
      const version = secrets.get(String(command.input.SecretId))?.find((v) => v.stages.includes(stage));
      if (version === undefined) {
        throw new ResourceNotFoundException({
          message: "Secrets Manager can't find the specified secret.",
          Message: "Secrets Manager can't find the specified secret.",
          $metadata: { httpStatusCode: 400 },
        });
      }
      return {
        Name: command.input.SecretId,
        VersionId: version.id,
        VersionStages: [...version.stages],
        ...version.value,
      };
    },
  };
  return {
    client: client as unknown as SecretsManagerClient,
    sent,
    /** Puts a new value, as `put-secret-value` does: it becomes AWSCURRENT and the old current becomes AWSPREVIOUS. */
    put(secretId: string, value: Version["value"]): void {
      const versions = secrets.get(secretId) ?? [];
      for (const version of versions) {
        version.stages = version.stages.includes("AWSCURRENT")
          ? ["AWSPREVIOUS"]
          : version.stages.filter((s) => s !== "AWSPREVIOUS");
      }
      versions.push({ id: `v${next++}`, value, stages: ["AWSCURRENT"] });
      secrets.set(secretId, versions);
    },
    /** The next read throws `error`. */
    failNext(error: Error): void {
      failures.push(error);
    },
    /** An SDK error of the service's own class, named `name`, whose message quotes `message`. */
    serviceError(name: string, message: string): Error {
      return new SecretsManagerServiceException({
        name,
        $fault: "client",
        $metadata: { httpStatusCode: 400 },
        message,
      });
    },
  };
}
