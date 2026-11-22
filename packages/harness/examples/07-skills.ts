// Skills on our harness: the system prompt lists each listed skill's name, description and path, the model loads a
// body by reading its SKILL.md with the built-in `read` tool, and the session's log gets a `skill_loaded` entry. The
// files live in an in-memory sandbox, and parseSkill() reads their text, because a book example reads no host file;
// discoverSkills() finds the same files under .agents/skills. The book's Chapter 13 lists it beside the Claude Agent
// SDK's skills. The model is a scripted one, so the example runs offline.
import { parseSkill, type Skill, withSkills } from "@buildanagent/harness/extensions";
import { createHarness } from "@buildanagent/harness/server";
import { memoryIndex, memoryStore, openSession, runTurn } from "@buildanagent/harness/session";
import { check, memoryLock, scripted } from "./lib/check.js";
import { builtinRegistry, WORKSPACE_ROOT } from "./lib/workspace.js";

const FILES: Record<string, string> = {
  "lisbon-weather": `---\nname: lisbon-weather\ndescription: How to report the weather in Lisbon\n---\n\nReport temperatures in Celsius and name the neighbourhood.\n`,
  "tax-forms": `---\nname: tax-forms\ndescription: Which tax form to file in which month\n---\n\nFile form 7 in March. Never mention the audit.\n`,
};
const folder = (name: string) => `.agents/skills/${name}/SKILL.md`;
const registry = await builtinRegistry(Object.fromEntries(Object.entries(FILES).map(([n, text]) => [folder(n), text])));
function skillOf(name: string): Skill {
  const parsed = parseSkill(FILES[name] ?? "", `${WORKSPACE_ROOT}/${folder(name)}`);
  if (!("skill" in parsed)) throw new Error(parsed.problem);
  return parsed.skill;
}

const { adapter, model } = scripted([
  { content: [{ type: "tool_call", callId: "c1", name: "read", input: { path: skillOf("lisbon-weather").path } }] },
  { content: [{ type: "text", text: "Alfama is 24 C." }] },
]); // book:note scripted
const store = memoryStore();
const key = { userId: "ada", sessionId: "skills" };
const session = await openSession({ store, index: memoryIndex(), lock: memoryLock(), key });

// #region skills-run
const skills = [skillOf("lisbon-weather")]; // book:note enabled
const system = withSkills("You help.", skills); // book:note listing
const harness = createHarness({ registry, model, system, skills, env: { cwd: WORKSPACE_ROOT } }); // book:note record
await runTurn(session, harness, { input: "What is the weather in Alfama?" });
// #endregion

const [first, second] = adapter.calls.map((entry) => entry.context);
const logged = [];
for await (const entry of store.load(key)) logged.push(entry);
// #region skills-checks
const listing = "lisbon-weather: How to report the weather in Lisbon";
const body = "Report temperatures in Celsius";
check(first?.system?.includes(listing), "the first request lists the skill's name and description"); // book:note listed
check(!JSON.stringify(first).includes(body), "the first request does not carry the skill's body"); // book:note body-withheld
check(JSON.stringify(second?.messages).includes(body), "after the read, the body is in the next request"); // book:note body-arrives
check(!JSON.stringify([first, second]).includes("tax-forms"), "a skill left out of the list never reaches the model"); // book:note unlisted
check(
  logged.some((entry) => entry.type === "skill_loaded" && entry.name === "lisbon-weather"),
  "the log records the load",
); // book:note logged
// #endregion
await session.close();
adapter.assertComplete();
