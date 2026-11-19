// The validator check: runs pi-schema 1.5.2, the SDK's validator, and @cfworker/json-schema 4.1.6, its fallback, on
// every fixture under test/fixtures/strict-schemas and test/fixtures/draft-07-output-schemas, and writes the results
// to docs/validator-check.md. pi-schema stays the validator unless it gets an instance wrong that the fallback gets
// right (SDK plan D7; ADR 0007).
//
//   node packages/sdk/scripts/validator-check.mjs           fails if docs/validator-check.md is out of date
//   node packages/sdk/scripts/validator-check.mjs --write   rewrites docs/validator-check.md
//
// test/validator-check.test.ts runs the same check under `pnpm test`.
import { readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Validator as CfworkerValidator } from "@cfworker/json-schema";
import { compile } from "@earendil-works/pi-schema";
import { formats } from "@earendil-works/pi-schema/formats";

const PACKAGE = new URL("../", import.meta.url);
const FIXTURE_SETS = [
  { folder: "strict-schemas", title: "Strict schemas from the Anthropic and OpenAI references" },
  { folder: "draft-07-output-schemas", title: "Draft 7 output schemas" },
];
export const REPORT = new URL("docs/validator-check.md", PACKAGE);
const DRAFT_7 = "http://json-schema.org/draft-07/schema#";

/** Reads every fixture of one set, sorted by name. */
function readFixtures(folder) {
  const dir = new URL(`test/fixtures/${folder}/`, PACKAGE);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(new URL(name, dir), "utf8")));
}

/** pi-schema's verdict and error paths for one instance. */
function piSchema(schema) {
  const validator = compile(schema, { draft: schema.$schema === DRAFT_7 ? "7" : "2020-12", formats });
  return (value) => {
    const paths = validator.check(value) ? [] : validator.errors(value).map((error) => error.path);
    return { valid: paths.length === 0, paths: [...new Set(paths)] };
  };
}

/** @cfworker/json-schema's verdict and error paths, as JSON Pointers instead of `#/…` fragments. */
function cfworker(schema) {
  const validator = new CfworkerValidator(schema, schema.$schema === DRAFT_7 ? "7" : "2020-12", false);
  return (value) => {
    const result = validator.validate(value);
    const paths = result.errors.map((error) => error.instanceLocation.replace(/^#/, ""));
    return { valid: result.valid, paths: [...new Set(paths)] };
  };
}

/** Runs one validator over a fixture's instances, valid ones first, and records which verdicts it gets right. */
function score(fixture, makeValidator) {
  const check = makeValidator(fixture.schema);
  const valid = fixture.valid.map((value) => check(value));
  const invalid = fixture.invalid.map(({ value }) => check(value));
  const right = [...valid.map((r) => r.valid), ...invalid.map((r) => !r.valid)];
  const correct = right.filter(Boolean).length;
  return { right, correct, total: right.length, invalidPaths: invalid.map((r) => r.paths) };
}

/** Runs both validators on every fixture. */
export function runCheck() {
  return FIXTURE_SETS.map((set) => ({
    ...set,
    rows: readFixtures(set.folder).map((fixture) => ({
      fixture,
      pi: score(fixture, piSchema),
      cf: score(fixture, cfworker),
    })),
  }));
}

/** The fixtures with an instance pi-schema gets wrong and the fallback gets right: the D7 rule's trigger. */
export function piSchemaLosses(sets) {
  return sets.flatMap((set) => set.rows).filter((row) => row.pi.right.some((right, i) => !right && row.cf.right[i]));
}

const verdict = ({ correct, total }) => `${correct === total ? "pass" : "FAIL"} (${correct}/${total})`;
const paths = (list) => (list.length === 0 ? "none" : list.map((p) => `\`${p === "" ? "(root)" : p}\``).join(", "));

function resultTable(set) {
  const lines = [
    `## ${set.title}`,
    "",
    "| Schema | Source | pi-schema 1.5.2 | @cfworker/json-schema 4.1.6 |",
    "| --- | --- | --- | --- |",
  ];
  for (const { fixture, pi, cf } of set.rows) {
    lines.push(`| \`${fixture.name}\` | [${fixture.section}](${fixture.source}) | ${verdict(pi)} | ${verdict(cf)} |`);
  }
  return lines;
}

function pathTable(sets) {
  const lines = [
    "## Error paths for the invalid instances",
    "",
    "Each row is one invalid instance. The expected path is where the mistake is, and each validator's column lists the JSON Pointers it reported. pi-schema reports each mistake once, at the property that holds it, which is the path-level message the tool pipeline shows the model. @cfworker/json-schema also reports every enclosing object, and reports a missing property at the object that lacks it.",
    "",
    "| Schema | Expected | pi-schema 1.5.2 | @cfworker/json-schema 4.1.6 |",
    "| --- | --- | --- | --- |",
  ];
  for (const { fixture, pi, cf } of sets.flatMap((set) => set.rows)) {
    fixture.invalid.forEach((instance, i) => {
      lines.push(
        `| \`${fixture.name}\` | ${paths(instance.paths)} | ${paths(pi.invalidPaths[i])} | ${paths(cf.invalidPaths[i])} |`,
      );
    });
  }
  return lines;
}

function notes(sets) {
  const noted = sets.flatMap((set) => set.rows).filter(({ fixture }) => fixture.note !== undefined);
  return ["## Notes on the fixtures", "", ...noted.map(({ fixture }) => `- \`${fixture.name}\`: ${fixture.note}`)];
}

// Found while packing the SDK, outside what the fixtures measure, so it is recorded here by hand.
const PACKAGING = [
  "## A packaging gap outside the fixtures",
  "",
  "pi-schema 1.5.2's `package.json` maps a `source` export condition to `./src/index.ts`, a file its tarball doesn't ship. Node therefore can't load pi-schema in a process started with `--conditions=source`, and neither can the SDK, which imports it. TypeScript and Vite resolve past the missing file. @cfworker/json-schema 4.1.6 has no `source` condition. The check's rule compares verdicts on fixture instances, and this gap changes no verdict, so it doesn't switch the validator. Reporting it upstream is a follow-up.",
];

/** The report, as Markdown. */
export function renderReport(sets) {
  const losses = piSchemaLosses(sets);
  const outcome =
    losses.length === 0
      ? "pi-schema gets no instance wrong that the fallback gets right, so it stays the SDK's validator."
      : `pi-schema gets instances wrong that the fallback gets right in ${losses.length} schemas, so the SDK must switch to the fallback.`;
  return [
    "# Validator check: pi-schema against @cfworker/json-schema",
    "",
    "This file is generated by `node packages/sdk/scripts/validator-check.mjs --write`; edit the script or the fixtures, not this file. The check runs both candidate validators on every fixture in `packages/sdk/test/fixtures/` with format checks on for both, and records each validator's verdict on each instance. pi-schema stays unless it judges an instance wrong that the fallback judges right. Each source link names the section the schema was copied from, as of November 2026.",
    "",
    `**Outcome.** ${outcome}`,
    "",
    ...sets.flatMap((set) => [...resultTable(set), ""]),
    ...pathTable(sets),
    "",
    ...notes(sets),
    "",
    ...PACKAGING,
    "",
  ].join("\n");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const report = renderReport(runCheck());
  if (process.argv.includes("--write")) {
    writeFileSync(REPORT, report);
  } else if (readFileSync(REPORT, "utf8") !== report) {
    console.error("docs/validator-check.md is out of date; rerun with --write");
    process.exitCode = 1;
  }
}
