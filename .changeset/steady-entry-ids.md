---
"@buildanagent/harness": patch
---

A session's entry ids and timestamps no longer depend on how fast its store appends. The session writer now takes each entry's id and time when the write is queued, the order the turn's other ids are taken in, so the same run writes the same log on the JSONL files, the in-memory store and the Cloudflare, AWS and Vercel stores. Before, an entry written while a slower store was still appending could swap ids with the next assistant message.
