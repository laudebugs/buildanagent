/** The two checks every AWS adapter shares: that it was given an SDK client, and the name of an error the SDK threw. */
import { HarnessError } from "../errors.js";

/** Throws `invalid_aws_options` unless `client` has a `send` method, as every AWS SDK v3 client does. */
export function checkClient(adapter: string, client: unknown): void {
  if (typeof (client as { send?: unknown } | undefined)?.send !== "function") {
    throw new HarnessError("invalid_aws_options", `${adapter} needs an AWS SDK v3 client, which has a send() method`);
  }
}

/**
 * The error's `name`, when it is an object with a string one. The adapters compare names, not classes, so a host that
 * bundles its own copy of the SDK still has its errors recognised.
 */
export function errorName(error: unknown): string | undefined {
  const name = typeof error === "object" && error !== null ? (error as { readonly name?: unknown }).name : undefined;
  return typeof name === "string" ? name : undefined;
}
