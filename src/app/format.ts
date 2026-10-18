/**
 * What the toolbar's formatting buttons do to the text. Every one of ByteMD's
 * actions — its own and those of the gfm, math and mermaid plugins — formats
 * through three helpers it hands them in its editor context: `wrapText`,
 * `replaceLines` and `appendBlock`. `editor.ts` swaps those three for the ones
 * built here, so every button and every shortcut gets them at once, with
 * nothing hidden or re-declared in the toolbar.
 *
 * What they do differently from ByteMD's:
 *
 * - A selection that ends at the start of a line — a triple-click, or
 *   shift-down — stops at the line above: the line break selected with the
 *   line does not bring the next one in.
 * - Every selection is formatted, not only the first.
 * - Wrapping a selection across lines wraps each line, past its list marker,
 *   quote or heading, and a second click unwraps them; one pair of `**`
 *   around a line break renders as nothing.
 * - Wrapping where there is no word writes a placeholder to type over: a bare
 *   `~~~~` or `$$` would open a block that swallows the rest of the draft.
 * - The line buttons toggle and convert: a list item clicked as a list loses
 *   its marker, a bullet clicked as numbered becomes numbered, and a heading
 *   takes the item's place instead of writing `## - item`. Blank lines in
 *   the selection stay blank, and numbers count per nesting level.
 * - A block appended at the end of the draft is selected where it landed, not
 *   one line below; a fence appended over a selection wraps it.
 *
 * The functions over lines are pure, and tested; `editorUtils` at the bottom
 * is the thin part that reads and writes CodeMirror.
 */
import type { Editor as CodeMirrorEditor } from 'codemirror';
import type CodeMirror from 'codemirror';
import { strings } from './strings.ts';
import { isBullet, isNumber, parseLine, readFence } from './syntax.ts';
import type { LineParts } from './syntax.ts';

export interface Pos {
  line: number;
  ch: number;
}

export interface Span {
  from: Pos;
  to: Pos;
}

/**
 * One replacement, and what to select once it is made: `anchor` and `head`
 * are offsets into `text`, so they stay right however the edits before this
 * one moved it.
 */
export interface Edit extends Span {
  text: string;
  anchor: number;
  head: number;
}

const before = (a: Pos, b: Pos) => a.line < b.line || (a.line === b.line && a.ch < b.ch);

/** A selection as CodeMirror keeps it, start first. */
export function ordered(anchor: Pos, head: Pos): Span {
  return before(head, anchor) ? { from: head, to: anchor } : { from: anchor, to: head };
}

/**
 * A selection that ends at column 0 of a later line ends at the line above.
 * Selecting a whole line selects its line break, which puts the end on the
 * next line; that line is not part of what was meant.
 */
export function trimLineBreak(lines: string[], span: Span): Span {
  const { from, to } = span;
  if (to.ch !== 0 || to.line <= from.line) return span;
  const line = to.line - 1;
  return { from, to: { line, ch: (lines[line] ?? '').length } };
}

function textOf(lines: string[], { from, to }: Span): string {
  if (from.line === to.line) return (lines[from.line] ?? '').slice(from.ch, to.ch);
  const middle = lines.slice(from.line + 1, to.line);
  return [
    (lines[from.line] ?? '').slice(from.ch),
    ...middle,
    (lines[to.line] ?? '').slice(0, to.ch),
  ].join('\n');
}

/**
 * Where `open` and `close` sit around the part of `line` from `start` to
 * `end`, each just inside it or just outside: the offsets of the first
 * marker's start and the last one's end. `null` when either is missing.
 */
function markersAround(
  line: string,
  start: number,
  end: number,
  open: string,
  close: string,
): [number, number] | null {
  const outer = line.startsWith(open, start)
    ? start
    : start >= open.length && line.startsWith(open, start - open.length)
      ? start - open.length
      : -1;
  if (outer < 0) return null;
  const inner =
    end - close.length >= outer + open.length &&
    line.startsWith(close, end - close.length)
      ? end
      : line.startsWith(close, end)
        ? end + close.length
        : -1;
  if (inner < 0 || inner - close.length < outer + open.length) return null;
  return [outer, inner];
}

/**
 * Wraps a span in `open` and `close`: the word under the caret, a selection,
 * or each line of a selection across lines. `caret` is where the caret was
 * when the span is the word found around it.
 */
export function wrapSpan(
  lines: string[],
  span: Span,
  open: string,
  close: string,
  placeholder: string,
  caret: Pos = span.from,
): Edit | null {
  const { from, to } = trimLineBreak(lines, span);
  const text = textOf(lines, { from, to });

  // Nothing to wrap: a placeholder, selected to be typed over. Markers with
  // nothing between them are a block of their own on an empty line — `~~~~`
  // a code fence, `$$` a formula, `****` a rule — down to the end of the draft.
  if (!text.trim()) {
    return {
      from: caret,
      to: caret,
      text: open + placeholder + close,
      anchor: open.length,
      head: open.length + placeholder.length,
    };
  }

  if (from.line === to.line) {
    const line = lines[from.line] ?? '';
    // Already wrapped: the markers come off, as ByteMD's own did.
    if (
      from.ch >= open.length &&
      line.slice(from.ch - open.length, from.ch) === open &&
      line.slice(to.ch, to.ch + close.length) === close
    ) {
      return {
        from: { line: from.line, ch: from.ch - open.length },
        to: { line: from.line, ch: to.ch + close.length },
        text,
        anchor: 0,
        head: text.length,
      };
    }
    return {
      from,
      to,
      text: open + text + close,
      anchor: open.length,
      head: open.length + text.length,
    };
  }

  // Across lines: each line on its own, since emphasis stops at a paragraph's
  // end and a list item's. A line taken from its start keeps its marker,
  // quote or heading outside the wrap.
  const segments: { line: string; start: number; end: number }[] = [];
  for (let i = from.line; i <= to.line; i++) {
    const line = lines[i] ?? '';
    const lead = line.length - parseLine(line).body.length;
    const start = Math.max(i === from.line ? from.ch : 0, lead);
    const end = i === to.line ? to.ch : line.length;
    segments.push({ line, start, end });
  }
  const filled = segments.filter(({ line, start, end }) => line.slice(start, end).trim());
  if (!filled.length) return null;

  // Every line already wrapped — the markers inside the selection, as the
  // wrap below leaves it, or just outside — and the markers come off.
  // Otherwise the lines not wrapped yet are, and the others are left as
  // they are, not wrapped twice.
  const around = filled.map((s) => markersAround(s.line, s.start, s.end, open, close));
  const unwrap = around.every(Boolean);

  const out: string[] = [];
  let offset = 0;
  let anchor = -1;
  let head = -1;
  for (const segment of segments) {
    const { line, start, end } = segment;
    const k = filled.indexOf(segment);
    if (k < 0) {
      out.push(line);
    } else if (unwrap) {
      const [outer, inner] = around[k]!;
      const text = line.slice(outer + open.length, inner - close.length);
      if (anchor < 0) anchor = offset + outer;
      head = offset + outer + text.length;
      out.push(line.slice(0, outer) + text + line.slice(inner));
    } else if (around[k]) {
      const [outer, inner] = around[k]!;
      if (anchor < 0) anchor = offset + outer + open.length;
      head = offset + inner - close.length;
      out.push(line);
    } else {
      const text = line.slice(start, end);
      if (anchor < 0) anchor = offset + start + open.length;
      head = offset + start + open.length + text.length;
      out.push(line.slice(0, start) + open + text + close + line.slice(end));
    }
    offset += out[out.length - 1]!.length + 1;
  }
  return {
    from: { line: from.line, ch: 0 },
    to: { line: to.line, ch: (lines[to.line] ?? '').length },
    text: out.join('\n'),
    anchor,
    head,
  };
}

export type LineAction =
  | { kind: 'bullet' }
  | { kind: 'ordered' }
  | { kind: 'task' }
  | { kind: 'quote' }
  | { kind: 'heading'; level: number };

/** The line each `replaceLines` callback is asked to map: see `lineActionOf`. */
export const LINE_PROBE = 'text';

/**
 * Which button called `replaceLines`. ByteMD hands over only the function it
 * maps each line through, so it is asked what it makes of `LINE_PROBE`, and
 * the answer is read as markdown, not matched as a string: a lead of one kind
 * in front of the line, untouched — `- `, `1. `, `- [ ] `, `> `, `## `, or the
 * same written another way. `null` for anything else, which is then applied
 * line by line as it was. `format.test.ts` runs ByteMD's own callbacks
 * through this, so an upgrade that writes something else fails a test.
 */
export function lineActionOf(written: string): LineAction | null {
  const p = parseLine(written);
  if (p.body !== LINE_PROBE || p.indent) return null;
  const leads = [p.quote !== '', p.marker !== null, p.heading > 0].filter(Boolean);
  if (leads.length !== 1) return null;
  if (p.quote) return /^>[ \t]?$/.test(p.quote) ? { kind: 'quote' } : null;
  if (p.heading) return { kind: 'heading', level: p.heading };
  if (p.box !== null) return p.box === ' ' ? { kind: 'task' } : null;
  return isNumber(p.marker) ? { kind: 'ordered' } : { kind: 'bullet' };
}

/**
 * The lines of one selection, as a line button leaves them. When every line
 * with words is already what the button makes, the button takes it off;
 * otherwise it makes every line that, converting markers rather than stacking
 * them. Markers go after the line's indent and quote, where they belong.
 */
export function applyLineAction(action: LineAction, lines: string[]): string[] {
  const parts = lines.map(parseLine);
  const filled = parts.filter((_, i) => lines[i]!.trim());
  // A blank line between items stays blank; a selection that is nothing but
  // blank lines is where a list is being started.
  const skip = (line: string) => filled.length > 0 && !line.trim();

  switch (action.kind) {
    case 'bullet':
    case 'ordered': {
      const same = action.kind === 'bullet' ? isBullet : isNumber;
      const all =
        filled.length > 0 && filled.every((p) => same(p.marker) && p.box === null);
      // Numbers count per level: a nested line starts at 1 under its parent,
      // and a line back at a parent's level carries on from it.
      const levels: { depth: number; count: number }[] = [];
      const number = (p: LineParts) => {
        const depth = (p.quote + p.indent).length;
        while (levels.length && levels[levels.length - 1]!.depth > depth) levels.pop();
        const level = levels[levels.length - 1];
        if (level?.depth === depth) return ++level.count;
        levels.push({ depth, count: 1 });
        return 1;
      };
      return parts.map((p, i) => {
        const line = lines[i]!;
        if (all) return line.trim() ? p.quote + p.indent + p.rest : line;
        if (skip(line)) return line;
        if (action.kind === 'bullet' && isBullet(p.marker) && p.box === null) return line;
        const marker = action.kind === 'bullet' ? '-' : `${number(p)}.`;
        return `${p.quote}${p.indent}${marker} ${p.rest}`;
      });
    }
    case 'task': {
      const all = filled.length > 0 && filled.every((p) => p.box !== null);
      return parts.map((p, i) => {
        const line = lines[i]!;
        if (all) return line.trim() ? p.quote + p.indent + p.rest : line;
        if (skip(line) || p.box !== null) return line;
        if (p.marker) return `${p.quote}${p.indent}${p.marker} [ ] ${p.rest}`;
        return `${p.quote}${p.indent}- [ ] ${p.rest}`;
      });
    }
    case 'quote': {
      const all = filled.length > 0 && filled.every((p) => p.quote !== '');
      if (all) return lines.map((line) => line.replace(/^[ \t]*>[ \t]?/, ''));
      return lines.map((line) => `> ${line}`);
    }
    case 'heading':
      // A heading is a line of its own: the item's marker, box and indent
      // give way to it. A quote stays around it.
      return parts.map((p, i) =>
        skip(lines[i]!) ? lines[i]! : `${p.quote}${'#'.repeat(action.level)} ${p.body}`,
      );
  }
}

/**
 * Where a block goes: after the paragraph the caret is in, on the first empty
 * line at or below it, or after a new empty line at the end. `line` is the
 * block's first line once it is in.
 */
export function appendBlockAt(
  lines: string[],
  caretLine: number,
  content: string,
): { at: Pos; text: string; line: number } {
  for (let i = caretLine; i < lines.length; i++) {
    if (!lines[i]!.trim()) {
      return { at: { line: i, ch: lines[i]!.length }, text: `\n${content}`, line: i + 1 };
    }
  }
  // No empty line below: one is added at the end, and the block after it.
  // ByteMD counted the lines after adding it and landed one line too far.
  const last = lines.length - 1;
  return {
    at: { line: last, ch: (lines[last] ?? '').length },
    text: `\n\n${content}`,
    line: last + 2,
  };
}

/**
 * An empty fence appended over a selection — the code-block button — wraps
 * the selected lines instead of being added below them. A fence inside the
 * selection gets one of the other kind around it, `~~~` around a ```` ``` ````,
 * so the language name stays where the button selects it, three characters
 * in; only when the selection holds both kinds is the fence made longer.
 * `null` when `content` is anything but an empty fence.
 */
export function fenceSpan(
  lines: string[],
  span: Span,
  content: string,
): { edit: Edit; line: number } | null {
  const [opening, closing, ...more] = content.split('\n');
  const fence = readFence(opening!);
  if (!fence || more.length || closing !== fence.run) return null;
  const { from, to } = trimLineBreak(lines, span);
  const body = lines.slice(from.line, to.line + 1);
  // Fences anywhere in the selection, a list item's included.
  const longest = (mark: string) =>
    Math.max(
      0,
      ...body.map((line) => {
        const inner = readFence(line.trimStart());
        return inner?.run[0] === mark ? inner.run.length : 0;
      }),
    );
  const given = fence.run;
  const other = given[0] === '`' ? '~' : '`';
  const run = !longest(given[0]!)
    ? given
    : !longest(other)
      ? other.repeat(given.length)
      : given[0]!.repeat(Math.max(given.length, longest(given[0]!) + 1));
  const text = [`${run}${fence.info}`, ...body, run].join('\n');
  return {
    edit: {
      from: { line: from.line, ch: 0 },
      to: { line: to.line, ch: (lines[to.line] ?? '').length },
      text,
      anchor: 0,
      head: 0,
    },
    line: from.line,
  };
}

/**
 * Edits made back to front, so each one's positions still hold, as one step
 * for undo; then each edit's selection, moved by the edits before it.
 * Overlapping edits — two carets in one word — keep the first.
 */
function apply(editor: CodeMirrorEditor, edits: Edit[]): void {
  const at = (pos: Pos) => editor.indexFromPos(pos);
  const sorted = [...edits].sort((a, b) => at(a.from) - at(b.from));
  const kept: Edit[] = [];
  for (const edit of sorted) {
    const last = kept[kept.length - 1];
    if (last && at(edit.from) < at(last.to)) continue;
    kept.push(edit);
  }
  if (!kept.length) return;
  let shift = 0;
  const marks = kept.map((edit) => {
    const start = at(edit.from) + shift;
    shift += edit.text.length - (at(edit.to) - at(edit.from));
    return [start + edit.anchor, start + edit.head] as const;
  });
  editor.operation(() => {
    for (const edit of [...kept].reverse()) {
      editor.replaceRange(edit.text, edit.from, edit.to, '+format');
    }
    editor.setSelections(
      marks.map(([anchor, head]) => ({
        anchor: editor.posFromIndex(anchor),
        head: editor.posFromIndex(head),
      })),
      marks.length - 1,
    );
  });
}

/** The three helpers ByteMD's actions format through, done as above. */
export function editorUtils(codemirror: typeof CodeMirror, editor: CodeMirrorEditor) {
  const lines = () => editor.getValue().split('\n');
  const spans = () =>
    editor.listSelections().map((range) => ordered(range.anchor, range.head));

  return {
    wrapText(open: string, close = open) {
      const doc = lines();
      const placeholder = strings.formatPlaceholders[open] ?? strings.formatPlaceholder;
      const edits = spans().map((span) => {
        if (before(span.from, span.to))
          return wrapSpan(doc, span, open, close, placeholder);
        const word = editor.findWordAt(span.from);
        const found = { from: word.from(), to: word.to() };
        return wrapSpan(doc, found, open, close, placeholder, span.from);
      });
      apply(
        editor,
        edits.filter((edit): edit is Edit => edit !== null),
      );
    },

    replaceLines(replace: (line: string, index: number) => string) {
      const doc = lines();
      const action = lineActionOf(replace(LINE_PROBE, 0));
      // The lines each selection covers, merged where two selections share one.
      const blocks: [number, number][] = [];
      for (const span of spans().sort((a, b) => a.from.line - b.from.line)) {
        const { from, to } = trimLineBreak(doc, span);
        const last = blocks[blocks.length - 1];
        if (last && from.line <= last[1]) last[1] = Math.max(last[1], to.line);
        else blocks.push([from.line, to.line]);
      }
      apply(
        editor,
        blocks.map(([first, last]) => {
          const block = doc.slice(first, last + 1);
          const next = action ? applyLineAction(action, block) : block.map(replace);
          const text = next.join('\n');
          return {
            from: { line: first, ch: 0 },
            to: { line: last, ch: doc[last]!.length },
            text,
            anchor: 0,
            head: text.length,
          };
        }),
      );
    },

    appendBlock(content: string): CodeMirror.Position {
      const doc = lines();
      // One block, at the main selection, as ByteMD placed it.
      const anchor = editor.getCursor('anchor');
      const head = editor.getCursor('head');
      if (before(anchor, head) || before(head, anchor)) {
        const fenced = fenceSpan(doc, ordered(anchor, head), content);
        if (fenced) {
          apply(editor, [fenced.edit]);
          return codemirror.Pos(fenced.line, 0);
        }
      }
      const block = appendBlockAt(doc, head.line, content);
      editor.replaceRange(block.text, block.at, block.at, '+format');
      return codemirror.Pos(block.line, 0);
    },
  };
}
