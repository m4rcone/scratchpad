/**
 * Task boxes in the preview that can be ticked. GitHub-flavoured markdown
 * draws `- [ ]` as a disabled checkbox; here a click on it writes the `x`
 * into the text, which is what the preview is drawn from.
 *
 * The preview does not know where in the text a box came from, but the parse
 * does: each task item keeps the offset its markdown starts at. The box is
 * given that offset, and a click looks there for the `[ ]` — so a preview a
 * keystroke behind the text finds nothing to tick instead of the wrong box.
 */
import type { HastNode } from './images.ts';
import { parseLine } from './syntax.ts';

const isTaskItem = (node: HastNode) =>
  node.tagName === 'li' &&
  Array.isArray(node.properties?.className) &&
  (node.properties.className as unknown[]).includes('task-list-item');

/** The item's own box: GFM puts it first, directly or in its paragraph. */
function boxOf(item: HastNode): HastNode | undefined {
  for (const child of item.children ?? []) {
    if (child.tagName === 'input') return child;
    if (child.tagName === 'p') return child.children?.find((n) => n.tagName === 'input');
    if (child.type === 'element') return undefined;
  }
  return undefined;
}

/** Runs after the sanitizer: every task box is enabled and told its offset. */
export function enableTaskBoxes(node: HastNode): void {
  for (const child of node.children ?? []) {
    if (child.type === 'element' && isTaskItem(child)) {
      const box = boxOf(child);
      const at = child.position?.start.offset;
      if (box?.properties && at !== undefined) {
        delete box.properties.disabled;
        box.properties.dataTaskAt = at;
      }
    }
    enableTaskBoxes(child);
  }
}

/**
 * The edit that ticks or unticks the box of the item starting at `at`: the
 * character between the brackets and what it becomes. `null` when there is
 * no task item there — the text moved on since the preview was drawn.
 */
export function toggleTask(
  text: string,
  at: number,
): { from: number; to: number; text: string } | null {
  const end = text.indexOf('\n', at);
  const line = text.slice(at, end < 0 ? text.length : end);
  const item = parseLine(line);
  if (item.box === null || item.quote || item.indent) return null;
  // Past the marker, only space comes before the box.
  const from = at + line.indexOf('[', item.marker!.length) + 1;
  return { from, to: from + 1, text: item.box === ' ' ? 'x' : ' ' };
}
