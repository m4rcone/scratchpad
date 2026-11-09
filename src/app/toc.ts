/**
 * The table of contents is ByteMD's drawer, but where its entries lead is
 * decided here. ByteMD lists the headings at the top level of the draft that
 * have text, and on a click scrolls to the nth heading of any kind in the
 * preview: a heading inside a quote or a list, or an empty `#`, put every
 * entry after it out by one. Nor could it go anywhere in the write view,
 * where the preview is folded away.
 *
 * So the parse marks the very headings the drawer lists, each with the
 * offset its markdown starts at — the same way task boxes learn theirs — and
 * the nth entry is the nth marked heading, in the preview and in the source.
 */
import type { HastNode } from './images.ts';
import { parseLine } from './syntax.ts';

const HEADING = /^h[1-6]$/;

/** Runs after the sanitizer: the drawer's headings, told where they start. */
export function markHeadings(tree: HastNode): void {
  for (const child of tree.children ?? []) {
    if (child.type !== 'element' || !HEADING.test(child.tagName ?? '')) continue;
    if (!child.children?.length) continue;
    const at = child.position?.start.offset;
    if (at !== undefined) child.properties = { ...child.properties, dataHeadingAt: at };
  }
}

/**
 * Which entry is the current one, given where each heading stands and where
 * the view's top is, in the same units: the last heading at or above it, and
 * the first when the view is above them all — as ByteMD has it.
 */
export function currentHeading(tops: number[], top: number): number {
  let current = 0;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i]! <= top) current = i;
    else break;
  }
  return current;
}

/** How far from a stale offset a heading is looked for, either way. */
const NEAR = 20;

/**
 * The line a heading entry leads to in the source. The preview is drawn a
 * moment after each keystroke, so an offset it marked may be a few characters
 * behind the text; when the line it lands on is not a heading, the nearest
 * heading line within reach is taken instead, and the line itself without one.
 */
export function headingLine(lines: string[], from: number): number {
  const isHeading = (line: string | undefined) => {
    if (line === undefined) return false;
    const parts = parseLine(line);
    return parts.heading > 0 && !parts.quote && !parts.indent && parts.marker === null;
  };
  for (let distance = 0; distance <= NEAR; distance++) {
    if (isHeading(lines[from - distance])) return from - distance;
    if (isHeading(lines[from + distance])) return from + distance;
  }
  return from;
}
