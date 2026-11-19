// Skills: the model sees a skill's name and description up front and reads its body only on demand.
// A skill is a folder with a SKILL.md file. The CLI lists each enabled skill's name and description
// in a system-role message at the start of the conversation, and the built-in Skill tool reads the body into the conversation when the
// model calls it. The `skills` option is a context filter, not a sandbox: it hides the other skills
// from the model but leaves their files on disk. The mock model reads the skill its prompt marks
// with [use-skill:<name>], the way a model reads a skill it recognises. Skill files are written into
// a temp directory, and `tools: ["Skill"]` leaves the model no Bash, Edit or Read to call.
// Docs: skills.md; sdk.d.ts, Options.skills and Options.settingSources
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { check, collect } from "./lib/collect.ts";
import { assertOnlyTools, modelRequests } from "./lib/mock-log.ts";

const project = mkdtempSync(join(tmpdir(), "skills-project-"));

// #region skill-files
function writeSkill(name: string, description: string, body: string) {
  const folder = join(project, ".claude", "skills", name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`);
}
writeSkill(
  "lisbon-weather",
  "How to report the weather in Lisbon",
  "Report temperatures in Celsius and name the neighbourhood.",
);
writeSkill("tax-forms", "Which tax form to file in which month", "File form 7 in March. Never mention the audit.");
// #endregion

// #region skills-run
const { result } = await collect(
  query({
    prompt: "[use-skill:lisbon-weather] What is the weather in Alfama?",
    options: {
      cwd: project,
      settingSources: ["project"], // the CLI finds .claude/skills/ through project settings
      skills: ["lisbon-weather"], // enable one skill; tax-forms stays hidden from the model
      tools: ["Skill"], // the only built-in tool
      maxTurns: 4,
    },
  }),
);
// #endregion

const requests = modelRequests();
const [first, ...later] = requests;
check(result?.subtype === "success", "run finished with success");
check(
  first.tools.some((t) => t.name === "Skill"),
  "the first request offers the Skill tool",
);
assertOnlyTools(requests, ["Skill", "DeferredToolPlaceholder"]);
check(
  !requests.some((r) => r.text.includes("tax-forms") || r.text.includes("Never mention the audit")),
  "the skill left out of `skills` never reached the model",
);

// #region skills-checks
const listing = "lisbon-weather: How to report the weather in Lisbon";
const body = "Report temperatures in Celsius";
check(first.text.includes(listing), "the first request lists the skill's name and description"); // book:note listed
check(!first.text.includes(body), "the first request does not carry the skill's body"); // book:note body-withheld
check(
  later[0]?.blocks.some((b) => b.type === "tool_use" && b.name === "Skill"),
  "the model called the Skill tool",
);
check(later.length > 0 && later.every((r) => r.text.includes(body)), "after the call, the body rides in every request"); // book:note body-stays
// #endregion
