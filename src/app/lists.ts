/**
 * Two corrections to how lists continue as they are typed. CodeMirror's
 * markdown addon writes the next item's marker on enter; these cover what it
 * leaves to the writer.
 *
 * Both are pure, over the lines of text; `editor.ts` calls them, and only on
 * lines CodeMirror has already read as a list, so a code block is left alone.
 */
import { isBullet, isNumber, parseLine, readBox } from './syntax.ts';

/**
 * The marker typed again by habit right after enter had written it — `- - `,
 * `2. 1. `, `- [ ] [ ] ` — folded back into one, as the line it should be.
 * `null` when the line is anything else. A typed task box wins over the one
 * enter wrote, since `[x]` there was meant.
 */
export function collapseRepeatedMarker(line: string): string | null {
  // Only right after the space that follows the second one: `- -` may still
  // become `- --flag`.
  if (!line.endsWith(' ')) return null;
  const p = parseLine(line);
  const lead = p.quote + p.indent;
  const again = parseLine(p.rest);
  const bare = again.box === null && again.rest === '';
  if (isBullet(p.marker) && isBullet(again.marker) && bare) {
    return `${lead}${p.marker} ${p.box === null ? '' : `[${p.box}] `}`;
  }
  const typed = readBox(p.rest);
  if (isBullet(p.marker) && p.box !== null && typed?.rest === '') {
    return `${lead}${p.marker} [${typed.box}] `;
  }
  if (isNumber(p.marker) && p.box === null && isNumber(again.marker) && bare) {
    return `${lead}${p.marker} `;
  }
  return null;
}

/**
 * Enter on an empty item of a nested list: the item steps out one level, to
 * follow its parent — the parent's marker, or the number after the parent's —
 * instead of ending every level at once. `null` when the line is not an empty
 * nested item, or no parent is found above it; enter then does what it does.
 */
export function outdentEmptyItem(lines: string[], index: number): string | null {
  const empty = parseLine(lines[index] ?? '');
  if (!empty.marker || !empty.indent || empty.rest.trim()) return null;

  for (let i = index - 1; i >= 0; i--) {
    const above = lines[i]!;
    if (!above.trim()) continue;
    const item = parseLine(above);
    if (!item.marker) {
      // A line of the list's text, indented under an item, is passed over;
      // anything back at the margin is the end of the list.
      if (/^\s/.test(above)) continue;
      return null;
    }
    if (item.indent.length >= empty.indent.length) continue;
    const ordered = /^(\d+)([.)])$/.exec(item.marker);
    const next = ordered ? `${Number(ordered[1]) + 1}${ordered[2]}` : item.marker;
    return `${empty.quote}${item.indent}${next}${item.box === null ? '' : ' [ ]'} `;
  }
  return null;
}
