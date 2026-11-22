// A compile-time check that `SessionEntry` and the type zod infers from the schema's source accept the same values,
// nested shapes and enum values included. `tsconfig.schema.json` compiles it with `exactOptionalPropertyTypes` off,
// because zod writes an optional field as `a?: T | undefined`, which that flag tells apart from `a?: T`. It still
// cannot see an optional field that only one side has, so test/schema.test.ts compares each entry's top-level
// field names, and the fixtures use every optional field.
import type { SessionEntry } from "@buildanagent/protocol";
import type { MirroredEntry } from "../scripts/session-entry-schema.js";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** `true` while the two types accept the same values; the assignment fails to compile otherwise. */
export const SAME_VALUES: Same<SessionEntry, MirroredEntry> = true;
