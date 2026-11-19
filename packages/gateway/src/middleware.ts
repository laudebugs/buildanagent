/**
 * Middleware composition: the first middleware is outermost (SDK plan §3.2).
 *
 * `transformParams` runs first to last, each seeing the previous one's result. `wrapStream` nests the same way, so the
 * first middleware's wrapper sees every event the inner ones pass on, retries included.
 */
import type { GatewayEvent, MiddlewareParams, ModelMiddleware } from "./runtime-types.ts";

/** Applies each middleware's `transformParams` in order. */
export async function transformParams(
  middleware: readonly ModelMiddleware[],
  params: MiddlewareParams,
): Promise<MiddlewareParams> {
  let current = params;
  for (const m of middleware) {
    if (m.transformParams) current = await m.transformParams(current);
  }
  return current;
}

/** Nests each middleware's `wrapStream` around `inner`, first outermost, and starts the outermost one. */
export function wrapStream(
  middleware: readonly ModelMiddleware[],
  params: MiddlewareParams,
  inner: () => AsyncIterable<GatewayEvent>,
): AsyncIterable<GatewayEvent> {
  let next = inner;
  for (const m of [...middleware].reverse()) {
    const wrap = m.wrapStream?.bind(m);
    if (!wrap) continue;
    const below = next;
    next = () => wrap({ next: below, context: params.context, options: params.options });
  }
  return next();
}
