---
"@buildanagent/sdk": minor
---

Breaking Changes: `SdkErrorCode` gains `invalid_recording`, `recording_expired` and `recording_mismatch`, and `ScriptStep` gains `StreamScript`, so an exhaustive `switch` over either needs a case for each.

New in `@buildanagent/sdk/testing`: `autoResponder()` answers like a cooperative model, calling one offered tool with input from `synthesizeInput()` and then answering in text. It never calls a tool on `DEFAULT_DENIED_TOOLS` (`bash`, `exec_command`, `shell`, `write`, `edit`, `delete`), and `denyTools` adds names or patterns. `recordPairs(model, { providerVersion, expiresAt })` records each call as a normalised request and response with every credential header and API key left out, and `replayPairs(pairs)` plays them back through a `ReplayModel`. A replay refuses an expired recording, one from another SDK release line, one whose stamp differs from `expect`, and a call that sends a request other than the recorded one, each with a `RecordingError`. `scriptedApprovals(answers)` answers approval requests in order through `blockingApprovals()`, `scriptedMcpServer()` lends namespaced third-party tools with scripted results, and `testSigner()` and `TEST_KEY_ID` re-export the safety package's fixed-key test signer. `ScriptedModel` also plays a `StreamScript`, a list of recorded events, exactly as recorded.
