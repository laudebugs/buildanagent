// Module resolution hook: doc examples (and initChatModel's dynamic imports for string model ids)
// get the shims in ../shims, which return scripted models. The shims import the real packages.
const SHIMS = {
  "@langchain/anthropic": new URL("../shims/anthropic.mjs", import.meta.url).href,
  "@langchain/openai": new URL("../shims/openai.mjs", import.meta.url).href,
};
export async function resolve(specifier, context, next) {
  if (SHIMS[specifier] && !context.parentURL?.includes("/shims/")) return { url: SHIMS[specifier], shortCircuit: true };
  return next(specifier, context);
}
