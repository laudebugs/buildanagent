---
"@buildanagent/harness": minor
---

Add the AWS state adapters, each on an AWS SDK v3 client the host passes in. `@buildanagent/harness/aws/dynamodb` holds `dynamoStore()`, a `SessionStore` that commits a batch of any size with one conditional put of the session's head, and `dynamoLock()`, a lease-item `SessionLock` with a growing fence and a clock-skew margin. `@buildanagent/harness/aws/scheduler` holds `eventBridgeScheduler()`, which turns each wake into a self-deleting one-time schedule, and `deliverWake()`, which holds an early wake until its time. `@buildanagent/harness/aws/secrets-manager` holds `secretsManagerKeyStore()`, a read-only `KeyStore` whose errors never hold the secret. The three AWS SDK clients are optional peers at 3.1169.0, and `HarnessErrorCode` gains `invalid_aws_options`, `aws_write_incomplete` and `invalid_wake_event`.
