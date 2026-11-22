// Session retention: a store that archives sessions older than 30 days, and one pass of `pruneSessions()` that purges
// them. The module runs the pass when it is imported, over a folder the caller names with `SESSIONS_DIR`.

import { fileLock, jsonlStore, pruneSessions } from "@buildanagent/harness/session/jsonl";

const dir = process.env.SESSIONS_DIR ?? "sessions";
const lock = fileLock({ dir: `${dir}/locks` });

const store = jsonlStore({ dir, retention: { days: 30, action: "archive" }, lock });
const { archived, purged, kept, skipped, errors } = await pruneSessions({
  dir,
  userId: "ada",
  retention: { days: 30, action: "purge" },
});

export { archived, errors, kept, purged, skipped, store };
