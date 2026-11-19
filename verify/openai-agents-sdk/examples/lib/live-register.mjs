// Preloaded by scripts/run-examples.mjs --live, after tsx: resolves @openai/agents/testing, when an example or one of
// its helpers in examples/ imports it, to live.ts, whose ScriptedModel answers from the live provider. live.ts itself
// still gets the real package. Hooks registered later run first, so this one sees each import before tsx does.
import { register } from "node:module";

const live = new URL("./live.ts", import.meta.url).href;
const examples = new URL("../", import.meta.url).href;
const hooks = `
export async function resolve(specifier, context, next) {
  const parent = context.parentURL ?? "";
  if (specifier === "@openai/agents/testing" && parent.startsWith(${JSON.stringify(examples)}) && parent !== ${JSON.stringify(live)}) {
    return { url: ${JSON.stringify(live)}, shortCircuit: true };
  }
  return next(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);
