/**
 * Two copies of one draft, put together. The text and the name change apart
 * — a rename leaves the text alone, and typing leaves the name — so each one
 * keeps its own clock: `updatedAt` for the text, which also orders the rail,
 * and `nameAt` for the name. Whichever copy changed a field last gives it.
 *
 * Without this, a rename would be lost on its way anywhere: another tab sees
 * the same text and keeps its own copy, the disk lets an older caret save
 * through over it, and a restore counts the draft as already here.
 */
import type { Draft } from './types.ts';

/** Whether `a` was renamed — or had its name cleared — after `b`. */
export function renamedLater(a: Draft, b: Draft): boolean {
  return (a.nameAt ?? 0) > (b.nameAt ?? 0);
}

/** Whether `incoming` brings text newer than `local`'s, and not the same. */
export function hasNewerText(local: Draft, incoming: Draft): boolean {
  return incoming.updatedAt > local.updatedAt && incoming.text !== local.text;
}

/** Whether `incoming` brings a different name, given or cleared later. */
export function hasNewerName(local: Draft, incoming: Draft): boolean {
  return renamedLater(incoming, local) && incoming.name !== local.name;
}

/**
 * `incoming` laid over `base`: the text and everything with it from
 * `incoming` when `textFromIncoming`, otherwise from `base`, and the name
 * from whichever was renamed last. A new object; neither copy is touched.
 */
export function mergeDraft(
  base: Draft,
  incoming: Draft,
  textFromIncoming: boolean,
): Draft {
  const merged: Draft = textFromIncoming ? { ...incoming } : { ...base };
  const named = renamedLater(incoming, base) ? incoming : base;
  delete merged.name;
  delete merged.nameAt;
  if (named.name) merged.name = named.name;
  if (named.nameAt !== undefined) merged.nameAt = named.nameAt;
  return merged;
}
