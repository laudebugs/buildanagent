# Release run 45067734004's E409 followed a 404 for a version npm had accepted, after the runs had run one at a time

On 2026-11-22, `release.yml` run [45067734004](https://github.com/laudebugs/buildanagent/actions/runs/45067734004) failed in its `publish` job with `E409 Cannot publish over previously staged version "0.1.0-alpha.28"` for `@buildanagent/harness`. It looked like two release runs published at once and collided on the harness. The job timestamps show otherwise, because the workflow's concurrency group made the second run wait until the first had finished. What the logs show instead is a sequence: npm accepted each upload of the first run, its version endpoint still answered 404 for 75 to 187 seconds afterwards, and a second upload in that window got the 409. That npm holds each accepted upload in a staged state until it goes public is an inference from the error's wording, not a documented rule. Nothing on npm is wrong. The release plan read those 404s as "not published", so the fix belongs in the plan, and the branch `fix/release-plan-released-first` makes it ask for the GitHub release first.

The failed run started from `39f83d4`, the merge of #330. That pull request finished harness todo N43, which adds sandbox read-back, capability flags and an egress policy. It merged three seconds after #335, the "Version packages to 0.1.0-alpha.28" pull request, which merged as `1f94c1e`. All six packages are public at `0.1.0-alpha.28` under `alpha`, each with provenance from the first run. A second run failed the same way 15 minutes later, so two changes follow: a merge rule, and the plan change on its own branch.

Every timestamp below is UTC. The job times come from `gh api repos/laudebugs/buildanagent/actions/runs/<id>/jobs`, the step times from each job's log (`gh api .../actions/jobs/<id>/logs`), and npm's times from the registry documents, all read on 2026-11-22. The fact-check rows are `docs/release-race-409-1` onward in [fact-check-publish-and-docs.md](fact-check-publish-and-docs.md#release-run-45067734004s-e409-2026-11-22).

## The two runs ran one after the other

Run A is [45067729944](https://github.com/laudebugs/buildanagent/actions/runs/45067729944), started by `1f94c1e` (#335). Run B is [45067734004](https://github.com/laudebugs/buildanagent/actions/runs/45067734004), started by `39f83d4` (N43, #330). Run B's first job was created at 20:42:42, the same second run A's `publish` job finished, so run B did nothing while run A ran.

| Time | Run | Event |
| --- | --- | --- |
| 20:40:10 | | #335 merges as `1f94c1e`, versioning all six packages to `0.1.0-alpha.28` |
| 20:40:13 | | #330 (N43) merges as `39f83d4`, whose parent is `1f94c1e` |
| 20:40:13 | A | Run A is created |
| 20:40:15 | B | Run B is created; it waits in the `release-push` concurrency group |
| 20:40:21 | A | `plan`: `publish=true`, because npm holds none of the six at `0.1.0-alpha.28` |
| 20:40:26–20:41:55 | A | `pack` builds the six tarballs from `1f94c1e` |
| 20:42:10 | A | `publish` checks the registry: all six answer 404 |
| 20:42:14–20:42:37 | A | `npm publish` returns `+` for gateway (20:42:14), SDK (20:42:18), agent-safety (20:42:23), protocol (20:42:28), harness (20:42:32) and CLI (20:42:37) |
| 20:42:39 | A | The GitHub release `v0.1.0-alpha.28` is published, its tag at `1f94c1e` |
| 20:42:42 | A | Run A's `publish` job completes |
| 20:42:42 | B | Run B's `plan` job is created |
| 20:42:51 | B | `plan`: `publish=true`, because npm "doesn't hold" any of the six at `0.1.0-alpha.28` |
| 20:42:57 | B | `pack` starts building the six tarballs from `39f83d4`, still versioned `0.1.0-alpha.28` |
| 20:43:33–20:44:33 | | npm makes four packages public: SDK (20:43:33), gateway (20:43:50), agent-safety (20:43:58), protocol (20:44:33) |
| 20:44:59 | B | `pack` ends |
| 20:45:13–20:45:14 | B | `publish` skips gateway, SDK, agent-safety and protocol as "already on npm"; harness answers 404 |
| 20:45:15–20:45:18 | B | `npm publish` of the harness signs provenance, then gets E409 "Cannot publish over previously staged version" |
| 20:45:19 | B | The `publish` job fails; the `docs` job is skipped |
| 20:45:40, 20:45:44 | | npm makes the harness and the CLI public |

The npm times in the table are each version's entry in the package document's `time` field. For each package, that entry falls 75 to 187 seconds after run A's `npm publish` returned, measured from the millisecond timestamps; the harness's 187 seconds run from 20:42:32.98 to 20:45:40.03, so the table's whole seconds read 188. The two earlier alphas show the same delay: the gateway at `0.1.0-alpha.26` went public 76 seconds after its publish returned, and at `0.1.0-alpha.27` 96 seconds after.

## The 409 followed a 404 for a version npm had accepted but not yet made public

Three explanations were offered for how two runs could publish at once: a workflow-level group with `cancel-in-progress: false`, a queued run whose plan ran early, and a group that didn't apply. The logs rule out all three, because the runs never overlapped.

1. **The concurrency group applied, and it serialised the runs.** `release.yml` sets `concurrency` at the workflow level, with `group: release-${{ github.event_name }}` and `cancel-in-progress: false`. Both runs were pushes, so both joined `release-push`. The group holds no ref or SHA, so every push run to `main` shares it. Run B's jobs were all created at or after 20:42:42, when run A's last job ended. GitHub held run B in the group for those 2 minutes 27 seconds; the jobs API shows no job of run B before then.
2. **Run B's plan ran after run A's publishes, not before.** Run B's `plan` ran at 20:42:51, 14 seconds after run A's last `npm publish` returned and 12 seconds after the GitHub release existed. It still read 404 for all six packages, because npm had made none of them public yet.
3. **A 404, then a 409, preceded the failure, with no race between runs.** By 20:45:13, npm had made four packages public, so run B's `publish` step skipped them. The harness was accepted but not yet public, so its version endpoint answered 404. Run B then tried to publish it, and npm refused, calling the version "previously staged". npm's [`npm stage` page](https://docs.npmjs.com/cli/v11/commands/npm-stage) says staged packages "share the same semver version unique index as published packages", and that a staged version is "not available for public access" until it is approved. Run A, though, used plain `npm publish`, not `npm stage publish`. Inference, not a documented rule: the error's wording and the 1–3 minute delay suggest that npm holds every trusted publish in a similar state before it goes public.

The provenance confirms that run B published nothing. Every package's SLSA statement on npm names run A (`runs/45067729944/attempts/1`) and commit `1f94c1e`. Run B's harness publish wrote a provenance statement to the transparency log (log index 4048236343) before the 409, but npm never attached it to a version.

**The plan publishes by version, not by commit.** Run B's `plan` saw `0.1.0-alpha.28` with nothing pending, and npm answering 404, so it set `publish=true` for `39f83d4`. Had npm accepted the upload, the harness would hold N43's code under a version whose changelog doesn't describe it. npm's version index refused it, and the "Refuse a version main has moved past" guard couldn't, because `main` was still at `0.1.0-alpha.28`. The GitHub release check in `release-plan.mjs` ran only when npm held all six packages, so the release that existed from 20:42:39 didn't stop the plan.

**npm made the packages public in a different order from the publishes.** Run A published gateway first, but npm showed the SDK 17 seconds before the gateway. For those 17 seconds, `@buildanagent/sdk@0.1.0-alpha.28` was installable while its dependency `@buildanagent/gateway@0.1.0-alpha.28` answered 404. The publish step's comment, that npm "never holds a package whose workspace dependency at that version is missing", holds for the order of the uploads only. A consumer who installs in that window gets a resolution error, not a wrong package, so the comment should say so when someone next edits `release.yml`.

## Run 45069201063 failed the same way 15 minutes later

The next Version packages merge repeated the sequence. Run [45069128158](https://github.com/laudebugs/buildanagent/actions/runs/45069128158), for #337, published `0.1.0-alpha.29` and created its GitHub release at 20:58:02. #336 had merged at 20:55:57 as `a0f70c0`, so its run, [45069201063](https://github.com/laudebugs/buildanagent/actions/runs/45069201063), waited in the group and planned at 20:58:20, 18 seconds after that release. It read 404 for all six. At 21:00:21 its publish step skipped the gateway, read 404 for the SDK and uploaded it, and npm answered E403 "You cannot publish over the previously published versions: 0.1.0-alpha.29." npm's `time` entry for that SDK version is 21:00:21.508, 157 seconds after run 45069128158's upload returned, so the SDK went public within the same second as run 45069201063's check. The status code differs from run B's, but the cause is the same: a plan that read npm's lag as "not published".

## After a Version packages merge, nothing else merges until its release run succeeds

**The rule.** After a Version packages pull request merges, merge nothing else into `main` until its `release.yml` run has completed successfully. A pull request with auto-merge on counts as a merge, so turn its auto-merge off for that window. The owner chose this direction on 2026-11-22: "when npm publish succeeds, we don't need to reverify the package is in npm". So the rule waits for the run alone and asks npm nothing.

**How to check it.** Before merging into `main`, run this check, and merge only when it prints nothing and the newest release run's conclusion is `success`:

```bash
gh run list --repo laudebugs/buildanagent --workflow release.yml --branch main --limit 5 \
  --json databaseId,status,conclusion --jq '.[] | select(.status != "completed")'
```

The command returns any release run that is queued, waiting or in progress. A coordinating session can run it before it merges anything into `main`.

## The fix: the plan asks for the GitHub release before it asks npm

The branch `fix/release-plan-released-first` changes `planRelease` in `scripts/ci/release-plan.mjs`. The plan now asks GitHub, with the run's read-only `GITHUB_TOKEN`, whether the release `v<version>` exists before it asks npm anything. When the release exists, the plan skips with "v<version> is already released" and makes no registry request. When it doesn't, the plan runs the registry check as before. It publishes what npm lacks, and it still publishes when npm holds all six, so the publish job creates the missing release. The publish job creates the release only after its last upload returns, and the concurrency group starts the next run only after that run ends. A queued run therefore finds the release and never reads npm's 404s for a released version: runs B and 45069201063 would both have skipped at their plans.

The change keeps every other path. A run that fails after some uploads leaves no release, so the next run publishes the rest, and the publish step still skips what npm holds. A run that fails after all six uploads but before the release is finished the same way. A different commit at an already-released version is skipped, which is right, because npm refuses that version anyway. A GitHub error other than 404 still stops the plan. One case still meets npm's lag: a run that plans within about 3 minutes of a run that failed between its uploads and its release. It can read 404 for those uploads and fail with the same 409, and a rerun once npm shows them finishes the release.

`release.yml` needs no change, so no session has to deliver a workflow file. The plan job keeps `contents: read` and its `GH_TOKEN`, the publish job keeps `contents: write` and `id-token: write`, and the plan's outputs keep their names. The owner chose this fix over a workflow change that would poll npm and check provenance after an E409, so this report no longer proposes one. The merge rule stays after the plan change merges, because it also keeps the one remaining case from arising.
