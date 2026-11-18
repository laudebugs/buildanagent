// Mirrors packages/coding-agent/src/core/extensions/pi-ai-extension-view.ts (Pi v1.5.2):
// the "@earendil-works/pi-ai" module that Pi hands to extensions at run time is pi-ai's compat
// entry plus TypeBox's Type, Static and TSchema and a StringEnum helper. Used only when
// type-checking extension code; ordinary programs import the real package.
import { type TUnsafe, Type } from "typebox";

export * from "@earendil-works/pi-ai/compat";
export type { Static, TSchema } from "typebox";
export { Type };
export function StringEnum<T extends readonly string[]>(
  values: T,
  options?: { description?: string; default?: T[number] },
): TUnsafe<T[number]> {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: values as unknown as T[number][],
    ...(options?.description && { description: options.description }),
    ...(options?.default && { default: options.default }),
  });
}
