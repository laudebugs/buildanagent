/** The permission pipeline's named error: a `HarnessError` with the code `invalid_permission_config`. */
import { HarnessError } from "../errors.js";

/**
 * Thrown when a permission configuration could never work as written. Today that is one case: an allow rule that
 * covers every call to a tool while a host callback is set, so the callback could never decide a call to that tool. A
 * configuration of deny rules, hooks and a host callback with no allow rules never throws it.
 */
export class PermissionConfigError extends HarnessError {
  override readonly name = "PermissionConfigError";

  constructor(message: string) {
    super("invalid_permission_config", message);
  }
}
