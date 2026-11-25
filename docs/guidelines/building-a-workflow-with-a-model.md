# Building a workflow with a model: guidelines from one import project

A model that fixes a messy spreadsheet looks impressive in a demo and tells you little about your product. The project behind these guidelines built a workflow that reads an unordered spreadsheet, maps it to a fixed import template, repairs what code can repair safely and explains the rest. Several agents and one owner built its first working version in a few days, and most of what went wrong was not about the model.

Teams measured the wrong thing, trusted a number that could not move, lost track of what was decided and what was built, and found out late which checks nobody had run. These guidelines fit any workflow where a model handles part of a job on structured data and code must stay in charge, not a one-off script or an open-ended chat with no data guarantees. Proving that the model earns its place, keeping code in charge of the data and running the project from checked files keep several agents and one owner aligned.

## 1. Decide what the model must add, then measure it

State, before you write a prompt, the one job that the model does better than code, and build the rest as plain code. A workflow of seven steps may need the model in only two of them, and the steps without it are cheaper, faster and testable offline. List the steps, mark each "code", "model" or "person", and write one sentence for each model step that says what a rules-only version would get wrong.

Build the rules-only version first and keep it. It gives you a baseline that costs nothing and runs in a fraction of a second, and it shows how far plain code goes before a model is needed. Add the model behind a switch, so the two versions run on the same input with the same checks. A project that adds the model first has no way to tell later whether the model did the work or the rules did.

Expect the answer to disappoint you. On sheets that our own generator made, the rules alone nearly matched the model, so that test could not show the model's value. The finding was useful, and it came only because the rules-only version existed and ran on the same files. Section 5 shows how to build a test that can tell the two apart: a second set, built against the rules.

## 2. Put code around the model

The model proposes and the code decides. Give the model no tool with a side effect, take its answers through strict tool calls with a schema, and check every answer against the specification before it reaches a file. A free-text answer that code then parses is a bug waiting for a long sheet.

Make four guarantees in code and test each one on purpose.

- **Row conservation.** Every input row appears in the output, appears in a held-back list with a reason or is excluded for a stated cause, exactly once. Write the formula down and test it as a property, because a model that drops a hard row looks like a model that fixed it.
- **Provenance.** Every output cell carries its source cell and the step that produced it, or the edit that a person made. A cell with no provenance counts as invented.
- **Hold back, never guess.** When code cannot repair a row safely, it moves the row to a separate held-back list with a reason and asks a person. Count held-back rows apart from passing rows, so no version can raise its pass rate by holding back more.
- **No silent side effects.** The workflow writes a file for a person to upload; it never writes to the target system. Record that rule as a decision, so changing it needs a new decision.

Put everything with a side effect behind a port (an interface that code calls instead of the real service): the model, the file store, the clock and the source of ids. Give each port a scripted double in the first week. With doubles, a server route, a seed command and a reset all test offline and deterministically. Retrofitting a clock into a route is how flaky tests start.

Write the test that breaks a guardrail on purpose. Fuzzing a header builder with thousands of hostile file names found leaks that review missed. A test also proved that a probe printing a model gateway's reply filters out any chunk of the secret key, not only the whole key. Do this wherever untrusted text meets a header, a file name, a log line or a prompt.

## 3. Treat every input as untrusted

A cell is data from a stranger. It can hold instructions for the model or a formula that a spreadsheet program runs when a person opens the output. A file can also hold a cell of ten thousand characters, a hidden sheet or a name in a script you did not plan for, and it can sit at the size limit. Build a small set of adversarial files for these cases and run the workflow on them with zero tolerance: one fabricated cell, one lost row or one written formula fails the run.

Guard against formula injection in the output as well as the input. A cell that starts with `=`, `+`, `-` or `@` can run as a formula in a spreadsheet program; published guidance on CSV injection adds the tab and the carriage return ([OWASP, CSV Injection](https://community.owasp.org/attacks/CSV_Injection)).

Decide in advance what the workflow does with such a cell, and write it as text that cannot run. Store the cell as a string type and check the output file, because a prefix character is unreliable after the file is saved again. A plain negative number also starts with `-`, so the rule changes that cell too, and you should decide it on purpose.

Treat file names the same way. Strip control characters and path separators before a name reaches a download header or a log line, and test the function with hostile names.

## 4. Keep one source of truth, and know what your stamp covers

Generate your specification from the system of record and never edit it by hand. When the target system validates imports, generate the template specs from its own source, and add a check that fails when the source and the spec drift apart. A spec that someone copied by hand starts to lie the day the target changes.

Record agreement with the target system as a stamp: a hash of everything the verdict depends on, the date and an expiry. The stamp says "the rules still agree with the validator, on these files, on this day". It has a cost that surprises teams, because it hashes more files than people expect.

Helper scripts and a test generator can sit inside the hash, so two ordinary changes in a week void it, and a remake needs live calls and the owner's yes. List the hashed paths in the first check of every task, and back that list with a test covering every file the verdict depends on. Put new tools outside those paths, batch the changes that touch them and remake the stamp once, close to the run that needs it.

Use one source for every vocabulary that docs, tests and code share. A seed file holds the sample records, and a module reads them for the browser tests. A check compares the table of problem kinds with the generator's own list, so a new pattern fails a check instead of slipping past. When a name changes, only one file changes. Add a test that fails whenever a spec spells a seeded name by hand; banning a second spelling keeps the source single and makes a stale literal fail loudly.

## 5. Evaluate with a ladder and a hard set

Build the evaluation as a ladder, from the start: the raw input, the rules only, one model call with the specification and the full workflow. Each step answers one question. The raw input shows how bad the start is. Rules only show what code achieves. One model call shows whether your code adds anything to a single call. The full workflow is the system under test. Without the ladder, "does the model help" stays a belief.

A set of files built by your own generator (the tidy set) flatters the rules. If the generator's heading wording came from the same synonym table that the rule-based matcher reads, the rules will almost never fail on it. Build a second set on purpose, with wording, languages and forms that the rules have never seen: unfamiliar headings, other languages, several values in one cell, names and dates in odd forms and mixed problems.

Choose its files by a rule written down before any model run, and let the rule use the rules-only baseline and never a model result. Report the two sets apart. The hard set was built against the rules, so its gain is where the rules struggle and not the average.

Fix the questions before the first run. Write each hypothesis with a direction and a margin, including the honest null ("the model adds nothing on the tidy set"), and check that the margin can be reached. A margin set against a baseline that already scores high has a ceiling. If the baseline passes nearly all rows, a gain of fifteen points over it is impossible, and no run can meet the threshold. Mark every threshold a proposal until a run has calibrated it.

Choose measures that a person can act on.

- **The main measure** is the share of fixable rows that pass the target system's own validator. Define a fixable row in the gold file (the file that holds the right answer for each generated sheet), so rows no tool can repair do not count against anyone.
- **Where the target has no validator**, say so, and measure agreement with the gold file instead. Never pool the two kinds of measure.
- **Secondary measures** are rows held back, columns mapped as the gold file says, decisions left to a person, fabricated cells, lost rows, cost and time.

Analyse by file, because the rows of one file share a sheet and are not independent. Pair the conditions on the same files. Report the mean difference with an interval from a bootstrap over files ([Efron and Tibshirani, 1993](https://www.routledge.com/An-Introduction-to-the-Bootstrap/Efron-Tibshirani/p/book/9780412042317)), and use Wilson intervals for proportions of rows ([Wilson, 1927](https://doi.org/10.1080/01621459.1927.10502953)). For whole-file pass or fail, use the exact binomial form of McNemar's test ([McNemar, 1947](https://doi.org/10.1007/BF02295996)).

Dror and colleagues explain which significance test fits which kind of result ([Dror et al., 2018](https://aclanthology.org/P18-1128/)). Run the model condition several times, because its answers vary. Report the share of files that pass on every run next to the mean; this is the idea behind pass^k, which the τ-bench authors introduced to measure reliability over repeated trials ([Yao et al., 2024](https://arxiv.org/abs/2406.12045)).

Seal a held-out set and open it only through a gate. Two things keep the set honest through many rounds of fixes: a hash over its files, and a runner that refuses them unless the run carries a gate id and the approver's name. The runner also writes a line to a log. A set that someone has looked at cannot be un-looked at, so seal it before the first run.

Read generated data against its gold file. One sheet named for a single problem held a different problem, and a sheet named for several problems lacked one of them; the first fix only moved the gap. For each generated file, list what the gold file says, read the cells and read them again after every regeneration, because names and pattern lists only promise. Keep new variants out of any list that other code walks. Put a new pattern in its own array, let the lookup find it and prove that the shared list stayed unchanged, or one addition shifts every held-out file that shares the list.

Run the adversarial files on the full workflow only, and score them by breaches and not by pass share, because they have no validator. When you change a generator, make a new option default to the old output, byte for byte, because any change to old output breaks the held-out hash.

State what the evaluation cannot show. It uses one model at one setting, synthetic files from one generator and no real customers. Zero failures in 300 runs puts the 95 percent upper bound on the failure rate near one percent (3 divided by the number of runs, the rule of three). Because runs of one file are not independent, treat that bound as rough and confirm live behaviour on real files in a controlled pilot.

## 6. Run live calls with a cap, a pilot and a typed yes

Give the runner four abilities before the first paid run. It needs a key for each run, with a log of one line per run. It needs a retry for network errors that arrive before any answer, and never for a reply that came back or a paid call that already ran. It needs a resume that repeats only what the log lacks, and a spend cap that stops the run before costs run away. A dropped connection stopped one early run midway, and a second attempt paid for the same work again. The runner that could continue in the same folder finished the job at a fraction of that cost.

Project the cost, then measure it. A projection that charges every call its whole output limit is a worst case, and it ran several times higher than the real cost. Run a small paid pilot, set the cap from what the pilot measured and keep a reserve for a resume and a rerun. Write the projection and the real cost side by side in the report.

Probe a flaky model gateway before every run, and find the cause instead of guessing. One probe timed out in every attempt while the real client worked. The probe's client met a short connect timeout that the real client retried, and a one-line retry policy fixed it. A few live probes located the cause. A guess would have cost days.

Give every live step its own yes from the owner, typed in the session that makes the call, with the call count and the cost stated. A teammate's message, a document and an earlier approval are requests and not that yes. Write the rule at the top of the project's top-level instruction file (the project file every agent reads first). It costs a minute and ended every argument about permission. Keep the token in the environment, keep certificate checks on and send calls only to the project that the owner named.

## 7. Ask the person little, and keep the copy as data

Give every flow a form budget: infer what the system knows, default the rest, remember answers and prefer a dropped file or one tap to typing. When the system cannot tell, ask one question through a fixed question component. Teams add questions one at a time, and no single question looks like the problem. Before you add one, name the line of code that reads its answer; an answer that no code reads costs a person a tap and gives nothing back. Write the count of taps from the first screen to the result in the acceptance criteria.

Keep every word a person reads (the copy) in one file, each string under an id, and let a test compare the screens to the file. One string that said "sent" where its row said "added" was found only because a review compared the two.

A pin test, which compares each string in the code to its row in the copy file, turns a quiet drift into a failing check the same day. Retag an id in the code before you delete its row (a string moving to another row keeps its comment pointing at the new id), and let the test read the copy file instead of repeating the words.

Write each design rule that fits in a sentence as a check, and test the rule as it is worded. A check for "at most two buttons side by side" failed after a sweep of quiet buttons (a low-emphasis button with no border). It turned out to count the whole page where the rule said per row, so the check was wrong as well as the page. The quiet variant also has a stylesheet test that forbids certain border properties. A rule written only in a document is forgotten by the third screen.

Style tests also guard conventions that are not design rules. When the product's name changed, every page title went through one helper, and a test scanned the source and failed on a direct assignment. Scope a shared style rule to the pages that need it, too: changing the wrap rule of a shared table made unrelated pages wider when they held a long unbroken word. Test such a word at the narrowest width for each page type.

Use idempotency keys (tokens that let a server recognise a retry of the same request) in forms with care. Because a server keeps the reply for a key, a retry after a failure sends the same key if the answer stayed the same and a new key if the answer changed.

Hide a feature with one switch and never delete it. When the owner wanted a whole group of features gone for now, one build-time constant hid them, the routes answered "not found" and every string stayed pinned. Ask "what would we need to turn this back on?" before you hide anything, and put the switch in one function. Decide in which state the tests run.

If every unit test and browser build runs with the switch on, the shipped state (off) is covered by only a few cases. The shipped state must be the tested state, or you need an explicit off-state check on the held list of unrun tests (Section 9). Scattered conditions leak: a card, a column and a chip kept showing state that the rest of the screen had forgotten.

## 8. Keep decisions, facts and specs in files that tests can read

Keep a decision log for the owner's choices. Record each decision with the options, your recommendation and the owner's exact words, and mark which part is your reading of those words. Owner decisions arrive mid-build, often relayed, and a builder who sees only a teammate's summary will treat it as the owner's word. A numbered decision that tasks name ends that confusion.

Keep a fact-check log with one row for each factual claim, a verdict and the source. Claims about code, a limit, a version, a date and a paper each get a row. Never renumber a row. Count the totals in a check, because a hand-counted list drifts by one and the failure shows up far from its cause. Mark a claim that you could only check against a secondary source or an abstract as unverified, and say why.

Say "decided" and "built" separately, in every status line, and write a specification for each screen with states, checks and a table of the exact words. After a build lands, read the code against its specification and record what matches and what does not. When tests are skipped, write "we read it and it matches", never "it works". Keep a sign-off page that states, item by item, what the owner decided, what is built and what is still open.

Split work into parts that land on their own. Cut a large screen by what a person can do after each stage: the server half first, then in-app editing, then the spreadsheet round trip, then exporting the finished file, each landed and reviewed alone.

When a task waits on two others that touch the same file, land the part that touches no one else's file first, and write the open part and its trigger into the task's outcome. Draw the file-overlap map of the first ten tasks before you hand them out. A shared header or shell serialises everything that touches it, so put the lightest load on the person at the head of that chain.

## 9. Test and review with fresh readers, and write down what you skipped

Keep tests offline and deterministic. The shared test setup blocks outbound network, fails when a model key is set in the environment and fails when certificate checks are off. Time, ids and randomness come from injected sources, and a scripted model stands in for the real one. Keep the gates that run on every change fast: format and lint, typecheck, the fact-check log count check, a search for conflict markers, the task-index check (which keeps the task list in sync) and one quick unit run.

Measure how long they take under load, and write down which tests are load-sensitive. A test that fails only on a loaded machine is a separate problem: run a failing file alone before you call it a bug. Record a layout baseline again in the same change as the text that moved it, or a stale baseline looks like a regression. Build the paths of a test from the test's own location rather than the working directory, which changes when tests run from the repository root.

Make each check say what it measures. A new check on table spacing failed dozens of tests because it also read hidden legends and grids built from divs. Limit a check to what it means and run it on a page that should pass. A check that fails for the wrong reason teaches people to ignore it.

Check how a new asset is served, too, and not only that it builds: one icon was copied by the build but sent with a generic binary type and a size the brief never asked for. Request the file from the real handler and read its Content-Type header and its size.

Review with a fresh reader. Give a reviewer the diff, the intent and the checks to make, never your conclusion, because a reviewer given your hypothesis tends to confirm it.

On most branches, a reviewer who saw only the diff found a defect the builder had missed. One was a button disabled while a call runs: it dropped keyboard focus, so a keyboard user had to tab back in after a failed call, and the author's browser test hid the bug by focusing the button first. The fix put focus back on the pressed answer, and the lesson is to check what a disabled control does to focus.

Another was an idempotency key dropped right after the server accepted the request, before the effect showed on the run. A third was copy that differed from its row. Look for tests that set up a state that a user would never have, such as a test that focused a button before it pressed it.

Make the owner's rule for skipping tests explicit and cheap to keep. If the owner pauses test and browser runs, keep every gate that needs no run of the product. That means format and lint, typecheck, the fact-check log count check, a search for conflict markers, the task-index check and one thorough review (two rounds for a defect fix). A paused project has no unit run among its gates.

The team landed many changes in a day that way, and the reviews caught real defects. The cost is a growing list of tests written and never run and browser checks nobody made. Open a held task (a task that waits until runs return) on the first day of any skip, and list in it every unrun test, file, change and command.

Keep the list in the repository, as a task file; squash messages are not a list. Ask each builder to add to it as they go and to mark each outcome "written, not run". Do not tick a checkbox for a check that did not happen. When runs return, the first run is a paid-off list and not a search through squash messages.

A probe script can stand in for a test: before you edit a generator, fingerprint its old output (bytes and gold file) for every case, and compare after the edit, saying what you compared. Where you can, reproduce an unrun test's logic in a small offline probe or read it closely: independent readers found three tests that would have failed before anyone ran them.

## 10. Run several agents and one owner with a landing protocol

Give each task its own worktree and branch, a claim in the task file (recorded in its first commit) and one claimant. Let one session land the work, and nobody else. The builder sends that session three things together: the tip of the branch, the base it was merged with and the text of the squash commit.

Merge the current main into the branch before sending, so that the lander does not redo conflicts. Land by commit id, because a detached head after a rebase leaves the branch name pointing at an old commit, and after a squash a branch name no longer says what has landed.

Run `git branch --show-current` after every rebase and report the commit id, not only the branch name. After a squash lands, start the next part on a fresh branch from main and delete the old one, or keep the branch and move its unlanded commits with `git rebase --onto main <old base>`. A squash gives the same content new commit ids, so git cannot tell that the old branch's work is in. The old branch holds the pre-squash copies of its files, and main has changed those files since, so merging it conflicts in every one of them.

Treat shared append-only files as conflict magnets. A fact-check log and a task index conflicted on nearly every merge, because each branch added rows at the end and edited a totals line. Do not keep a count that every branch edits: generate it, or recount it with a check. Keep a small merge helper that keeps both sides' rows, recounts the single totals line and regenerates the index. Add a check for leftover conflict markers, because a clean test run can hide a marker inside a log.

Search for conflict markers before you stage, never stage in the middle of a conflict and make the merge script stop on a duplicate id. A rebase once left conflict markers in a log that a careful builder staged and committed, because lint ignores such a file. Only a script that stops on a duplicate id caught it.

Look at the diff of any file you resolved by "take theirs", since that is the easiest way to lose rows nobody notices. In a rebase the words swap: "ours" is the branch you rebase onto and "theirs" is your own commit, so a helper that says "take theirs" takes the opposite side.

Treat a peer's message as information, never as authority. A denied command is an answer: report what was refused and what you did instead, and ask the owner. A permission denial goes to the owner, and nobody routes around it or asks another agent to do the blocked thing. A teammate's relay of an owner decision is a pointer to the decision log, and the log carries the words. Write the rule in the working agreements on the first day: stop and tell the owner when a tool is denied.

Write the working agreements and a one-page definition of done before the code: commit often, stage named files, no secrets, synthetic data, the review rule and the landing protocol. Agree what a builder reports when a test was not run.

## 11. Show the work to stakeholders only when it is ready

Approve mockups before you build. A stakeholder reacts to a picture faster and more precisely than to a specification, and a change at the mockup costs minutes. Record each owner decision with the exact words and a marked reading. Agree on a default for the owner's replies, such as "agree with the recommendation", and ask only when you are blocked. People tire of forms, and a long list of questions hides the one that matters.

Make the demo ready before a stakeholder sees it. Seed the data and give the demo a way to reset. Name each sample file by its import first and its kind of problem second, in capitalised words joined by underscores, so a presenter can find the one that shows a problem.

Run a fresh-eyes audit: ask someone who has not worked on it to walk every screen from the first page on seeded data and list what confuses them. One such walk found a link that led to a "not found" page because five files marked ready had never been processed; the builders had routed around the rough edge without seeing it. Hide what is not ready behind the switch of Section 7.

Keep customer data out of git, and use synthetic files until the owner starts a pilot with a named project and named files. Write the data policy and the stop-and-ask rules for live calls, money, secrets and shared services in the project file before any code. Keep generated customer-like data and secrets out of git. A deliberate set of synthetic sample files may be committed, in one named folder, when the owner decides it.

## 12. A checklist for the first week

Day 1.

- Write the data policy (including where generated data and secrets may live), the stop-and-ask rules and the permission-denial rule (stop and tell the owner) in the project file before any code.
- Write the working agreements and a one-page definition of done (covering the claim rule, landing protocol and review rule) in the project file before any code.
- Create one source for names and one file for the copy, each with a test that bans a second spelling or an unpinned string.
- Define the ports (model, store, clock, ids) and their scripted doubles, and make the first test pass offline.
- Create the decision log and the fact-check log, with a check that counts the fact-check log's rows.

Day 2.

- Build the thinnest end-to-end slice on synthetic data, with the rules-only version first and the model behind a switch.
- Fix the gates that run on every change and measure their time under load.
- Draw the file-overlap map of the first ten tasks and order them by it.

Day 3.

- Start the evaluation ladder, and seal the held-out set before the first run. Write the hypotheses, the margins and the file-selection rule before any run.
- Run the first fresh-reader review using the review rule: give the reviewer the diff, the intent and the checks to make, never your conclusion.
- Set the form budget for the main flow, and enforce the rule that each question names the code that reads its answer.

Day 4.

- Decide what the stamp hashes, list the paths and add a test that checks the list against every file the verdict depends on.
- Add the runner's run key, retry, resume and spend cap, test the resume offline and add a cost-projection command.

Day 5.

- Run a throwaway probe for each of the two first risks. For the data policy, try to leak a fake token into a log line, a header and a file name, and check that nothing reaches them. For the model gateway, call it once with no payload and read its error.
- Run the whole suite once on a quiet machine, and record the baseline times and the load-sensitive tests.
- Run a small paid pilot, with the owner's typed yes, and set the spend cap from what it cost.

Throughout, write a row in the fact-check log for every claim a task cites, and keep the held list of unrun tests up to date if tests are ever paused.

## Appendix: a template for an evaluation protocol

Write the protocol before any run and change it only through a dated table of amendments.

1. **The question**, and what the study will not say.
2. **The conditions**, on the same files with the same stamp: raw input, rules only, one model call with the specification and the full workflow.
3. **The files**: a tidy set, a hard set built against the rules and an adversarial set (run on the full workflow only and scored by breaches). State how files enter the hard set (by the rules-only baseline only), what stays sealed and which files stayed out and why.
4. **The hypotheses**, each with a direction and a margin, including the honest null, and a check that the margin can be reached.
5. **The measures**: the main one and its validator, the measure for imports that have no validator and the secondary ones.
6. **The analysis**: the unit (the file), the pairing, the intervals, the exact paired test, repeated runs of the model condition with the all-runs pass share (pass^k) next to the mean and the table that says where the model adds nothing.
7. **The budget**: the projection, the cap, the pilot and the reserve.
8. **The live steps**, in order (build and dry-run first, the stamp remake last before the pilot, then the pilot, then the paid run), with their call counts and which steps spend money, each needing its own typed yes.
9. **What the report records**: versions, hashes, seeds, model and setting, and the amendments.
10. **How the report reads**: hypotheses first, a null result in the same space as a gain, a safety breach first, departures named and no claim beyond what the study can show.
11. **The limits**: the single model and setting, the synthetic generator, the absence of real customers and the rough nature of any zero-failure bound.

Fix these eleven sections before the first paid run so every later number has a pre-registered meaning and every departure is visible.
