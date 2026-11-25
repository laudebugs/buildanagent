import { test } from "vitest";
import type { E2BSdk } from "../../src/sandbox/e2b/sdk.js";

// The backend's structural view of the SDK must accept the real `e2b` 2.63.0 classes, so `{ Sandbox, Secret }` from
// the package can be passed as `sdk`. This is a type check only: nothing here loads `e2b` or calls E2B.
type RealSdk = typeof import("e2b");
export const fromRealSdk = (sdk: RealSdk): E2BSdk => ({ Sandbox: sdk.Sandbox, Secret: sdk.Secret });

test("the real e2b classes satisfy E2BSdk, which tsc checks", () => {});
