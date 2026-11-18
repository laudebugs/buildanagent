// Module resolution hook: doc examples importing @ai-sdk/openai or @ai-sdk/anthropic get the
// shims in ../shims, which return mock models. The shims themselves import the real packages.
const SHIMS = {
  "@ai-sdk/openai": new URL("../shims/openai.mjs", import.meta.url).href,
  "@ai-sdk/anthropic": new URL("../shims/anthropic.mjs", import.meta.url).href,
};
export async function resolve(specifier, context, next) {
  if (SHIMS[specifier] && !context.parentURL?.includes("/shims/")) return { url: SHIMS[specifier], shortCircuit: true };
  return next(specifier, context);
}
