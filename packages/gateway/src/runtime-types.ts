/** Gateway runtime types used before the full runtime lands in B4 (SDK plan §3.2). */

/** How an adapter sends HTTP. Defaults to `globalThis.fetch`. */
export type Transport = (request: Request) => Promise<Response>;
