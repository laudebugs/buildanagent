# @buildanagent/protocol

The protocol package holds the types that cross a boundary: the entries of a session log, the messages a client and a harness exchange, and the JSONL framing that carries them. Nothing runs from it yet.

As of November 2026 the package is private and not on npm. It imports the gateway and the SDK for types only, so its built JavaScript loads neither. The entry union, the messages and the framer arrive in later todos. The [harness plan](https://github.com/laudebugs/buildanagent/blob/main/docs/plans/build-harness.md) says what each package will hold and in which order.
