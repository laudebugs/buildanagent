import type { Point, Position } from "unist";

/**
 * The point `index` characters into a text node that starts at `start`. A text node can span lines, because a soft
 * line break stays in its value, so the line counts the newlines before `index`. Plugins that cut a text node into
 * pieces give each piece its own position this way, so an error inside one still names its line.
 */
export function pointAt(start: Point, value: string, index: number): Point {
  const before = value.slice(0, index).split("\n");
  const last = before.at(-1) ?? "";
  return {
    line: start.line + before.length - 1,
    column: before.length === 1 ? start.column + index : last.length + 1,
    ...(start.offset === undefined ? {} : { offset: start.offset + index }),
  };
}

/** The position of the characters `from` to `to` of a text node at `position`, or undefined when it has none. */
export function slicePosition(
  position: Position | undefined,
  value: string,
  from: number,
  to: number,
): Position | undefined {
  if (position === undefined) return undefined;
  return { start: pointAt(position.start, value, from), end: pointAt(position.start, value, to) };
}

/** A stand-in node for a failure inside a text node, so the message names the line of the failing characters. */
export function placeAt(
  position: Position | undefined,
  value: string,
  from: number,
  to: number,
): { readonly position?: Position } {
  const sliced = slicePosition(position, value, from, to);
  return sliced === undefined ? {} : { position: sliced };
}
