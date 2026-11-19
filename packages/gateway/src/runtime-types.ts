/** Gateway runtime types (SDK plan §3.2). The rest of the runtime joins them here. */

/** How an adapter sends HTTP. Defaults to `globalThis.fetch`. */
export type Transport = (request: Request) => Promise<Response>;
