/**
 * Two corrections to how lists continue as they are typed. CodeMirror's
 * markdown addon writes the next item's marker on enter; these cover what it
 * leaves to the writer.
 *
 * Both are pure, over the lines of text; `editor.ts` calls them, and only on
 * lines CodeMirror has already read as a list, so a code block is left alone.
 */

/** A list item's lead: quote marks, indent, marker, and a task box if any. */
const ITEM = /^((?:\s*>)*)(\s*)([-*+]|\d+[.)])( \[[ xX]\])? /;

/**
 * The marker typed again by habit right after enter had written it — `- - `,
 * `2. 1. `, `- [ ] [ ] ` — folded back into one, as the line it should be.
 * `null` when the line is anything else. A typed task box wins over the one
 * enter wrote, since `[x]` there was meant.
 */
export function collapseRepeatedMarker(line: string): string | null {
  const bullet = /^((?:\s*>)*\s*)([-*+]) (\[[ xX]\] )?[-*+] $/.exec(line);
  if (bullet) return `${bullet[1]}${bullet[2]} ${bullet[3] ?? ''}`;
  const box = /^((?:\s*>)*\s*[-*+] )\[[ xX]\] (\[[ xX]\]) $/.exec(line);
  if (box) return `${box[1]}${box[2]} `;
  const ordered = /^((?:\s*>)*\s*)(\d+[.)]) \d+[.)] $/.exec(line);
  if (ordered) return `${ordered[1]}${ordered[2]} `;
  return null;
}

/**
 * Enter on an empty item of a nested list: the item steps out one level, to
 * follow its parent — the parent's marker, or the number after the parent's —
 * instead of ending every level at once. `null` when the line is not an empty
 * nested item, or no parent is found above it; enter then does what it does.
 */
export function outdentEmptyItem(lines: string[], index: number): string | null {
  const line = lines[index] ?? '';
  const empty = /^((?:\s*>)*)(\s+)([-*+]|\d+[.)])( \[[ xX]\])?\s*$/.exec(line);
  if (!empty) return null;
  const [, quote, indent] = empty;

  for (let i = index - 1; i >= 0; i--) {
    const above = lines[i]!;
    if (!above.trim()) continue;
    const item = ITEM.exec(above);
    if (!item) {
      // A line of the list's text, indented under an item, is passed over;
      // anything back at the margin is the end of the list.
      if (/^\s/.test(above)) continue;
      return null;
    }
    const [, , parentIndent, marker, box] = item;
    if (parentIndent!.length >= indent!.length) continue;
    const ordered = /^(\d+)([.)])$/.exec(marker!);
    const next = ordered ? `${Number(ordered[1]) + 1}${ordered[2]}` : marker;
    return `${quote}${parentIndent}${next}${box ? ' [ ]' : ''} `;
  }
  return null;
}
