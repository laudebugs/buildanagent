/**
 * What the SDK needs to know about a run's `app` data. A pause binds a MAC of the app's canonical JSON (RFC 8785) into
 * its signed request, so an app must have a canonical JSON form: no `Date`, class instance, function, `undefined`
 * inside an array or number that is not finite. The app itself is never stored, logged or put in an error.
 */
import { appPayload } from "./vendor/agent-safety/pending.js";

/** True when `app` has a canonical JSON form, which a pause needs to bind it. */
export function isHashable(app: unknown): boolean {
  try {
    appPayload(app);
    return true;
  } catch {
    return false;
  }
}
