import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendBlockAt,
  applyLineAction,
  fenceSpan,
  LINE_PROBE,
  lineActionOf,
  trimLineBreak,
  wrapSpan,
} from './format.ts';
import type { Edit, LineAction, Span } from './format.ts';

const span = (fromLine: number, fromCh: number, toLine: number, toCh: number): Span => ({
  from: { line: fromLine, ch: fromCh },
  to: { line: toLine, ch: toCh },
});

/** The text an edit leaves, and what it selects, for one-edit assertions. */
function result(doc: string, edit: Edit | null): { text: string; selected: string } {
  assert.ok(edit);
  const lines = doc.split('\n');
  const index = (line: number, ch: number) =>
    lines.slice(0, line).reduce((sum, l) => sum + l.length + 1, 0) + ch;
  const start = index(edit.from.line, edit.from.ch);
  const text =
    doc.slice(0, start) + edit.text + doc.slice(index(edit.to.line, edit.to.ch));
  return { text, selected: text.slice(start + edit.anchor, start + edit.head) };
}

const wrap = (doc: string, s: Span, open: string, close = open, caret?: Span['from']) =>
  result(doc, wrapSpan(doc.split('\n'), s, open, close, 'bold text', caret));

test('a selection ending at the start of a line stops at the line above', () => {
  const lines = ['one', 'two', 'three'];
  assert.deepEqual(trimLineBreak(lines, span(0, 0, 1, 0)), span(0, 0, 0, 3));
  assert.deepEqual(trimLineBreak(lines, span(0, 2, 2, 0)), span(0, 2, 1, 3));
  // A caret, or a selection that is only the break itself, is left alone.
  assert.deepEqual(trimLineBreak(lines, span(1, 0, 1, 0)), span(1, 0, 1, 0));
  assert.deepEqual(trimLineBreak(lines, span(1, 2, 1, 3)), span(1, 2, 1, 3));
});

test('a selection on one line is wrapped, and unwrapped when already wrapped', () => {
  assert.deepEqual(wrap('hello world', span(0, 6, 0, 11), '**'), {
    text: 'hello **world**',
    selected: 'world',
  });
  assert.deepEqual(wrap('hello **world**', span(0, 8, 0, 13), '**'), {
    text: 'hello world',
    selected: 'world',
  });
  assert.deepEqual(wrap('see word', span(0, 4, 0, 8), '[', '](url)'), {
    text: 'see [word](url)',
    selected: 'word',
  });
});

test('where there is no word, a placeholder is written and selected', () => {
  // An empty line: `~~~~` or `$$` alone would open a block to the draft's end.
  assert.deepEqual(wrap('a\n\nb', span(1, 0, 1, 0), '~~'), {
    text: 'a\n~~bold text~~\nb',
    selected: 'bold text',
  });
  // Between two spaces, the word found is the spaces: the caret is kept.
  assert.deepEqual(wrap('a  b', span(0, 1, 0, 3), '**', '**', { line: 0, ch: 2 }), {
    text: 'a **bold text** b',
    selected: 'bold text',
  });
});

test('a selection across lines wraps each line past its lead', () => {
  assert.deepEqual(wrap('line one\nline two', span(0, 0, 1, 8), '**'), {
    text: '**line one**\n**line two**',
    selected: 'line one**\n**line two',
  });
  assert.deepEqual(wrap('- a\n- b', span(0, 0, 1, 3), '**'), {
    text: '- **a**\n- **b**',
    selected: 'a**\n- **b',
  });
  assert.deepEqual(wrap('para one\n\npara two', span(0, 0, 2, 8), '*'), {
    text: '*para one*\n\n*para two*',
    selected: 'para one*\n\n*para two',
  });
  // A partial selection wraps only what is selected on its first and last lines.
  assert.equal(
    wrap('one two\nthree four', span(0, 4, 1, 5), '`').text,
    'one `two`\n`three` four',
  );
});

test('a selection across lines wrapped again is unwrapped', () => {
  // The selection the wrap leaves, clicked again: the markers come off.
  assert.deepEqual(wrap('**line one**\n**line two**', span(0, 2, 1, 10), '**'), {
    text: 'line one\nline two',
    selected: 'line one\nline two',
  });
  // The markers just outside a selection count as well.
  assert.deepEqual(wrap('- **a**\n- **b**', span(0, 4, 1, 5), '**'), {
    text: '- a\n- b',
    selected: 'a\n- b',
  });
  // The whole lines selected, markers inside.
  assert.equal(wrap('*one*\n\n*two*', span(0, 0, 2, 5), '*').text, 'one\n\ntwo');
  // One line not wrapped yet: it is wrapped, and the other left alone.
  assert.deepEqual(wrap('**a**\nb', span(0, 0, 1, 1), '**'), {
    text: '**a**\n**b**',
    selected: 'a**\n**b',
  });
});

test('a triple-clicked line is wrapped alone, its line break left out', () => {
  assert.deepEqual(wrap('line one\nline two', span(0, 0, 1, 0), '**'), {
    text: '**line one**\nline two',
    selected: 'line one',
  });
});

test('a line button is told apart by what it makes of a line', () => {
  const of = (lead: string) => lineActionOf(lead + LINE_PROBE);
  assert.deepEqual(of('- '), { kind: 'bullet' });
  assert.deepEqual(of('* '), { kind: 'bullet' });
  assert.deepEqual(of('1. '), { kind: 'ordered' });
  assert.deepEqual(of('1) '), { kind: 'ordered' });
  assert.deepEqual(of('- [ ] '), { kind: 'task' });
  assert.deepEqual(of('> '), { kind: 'quote' });
  assert.deepEqual(of('### '), { kind: 'heading', level: 3 });
  // Anything else is applied as ByteMD wrote it.
  assert.equal(of(''), null);
  assert.equal(of('> - '), null);
  assert.equal(of('- [x] '), null);
  assert.equal(of('  - '), null);
  assert.equal(lineActionOf(`**${LINE_PROBE}**`), null);
});

/**
 * Every `replaceLines` callback in the ByteMD build installed, and in its gfm
 * plugin, read from their source: the actions are not exported. The heading
 * dropdown's callback closes over its `level`, which is handed in as 2.
 */
function byteMdLineCallbacks(): ((line: string, index: number) => string)[] {
  const callbacks = [];
  for (const file of ['bytemd/dist/index.mjs', '@bytemd/plugin-gfm/dist/index.mjs']) {
    const source = readFileSync(
      new URL(`../../node_modules/${file}`, import.meta.url),
      'utf8',
    );
    const call = 'replaceLines(';
    for (
      let at = source.indexOf(`${call}(`);
      at >= 0;
      at = source.indexOf(`${call}(`, at + 1)
    ) {
      let depth = 0;
      let end = at + call.length - 1;
      for (; end < source.length; end++) {
        if (source[end] === '(') depth++;
        else if (source[end] === ')' && --depth === 0) break;
      }
      const body = source.slice(at + call.length, end);
      callbacks.push(new Function('level', `return (${body});`)(2));
    }
  }
  return callbacks;
}

test('every line button ByteMD has is one this knows', () => {
  const kinds = byteMdLineCallbacks().map((replace) =>
    lineActionOf(replace(LINE_PROBE, 0)),
  );
  assert.deepEqual(kinds, [
    { kind: 'heading', level: 2 },
    { kind: 'quote' },
    { kind: 'bullet' },
    { kind: 'ordered' },
    { kind: 'task' },
  ]);
});

const lines = (action: LineAction, text: string) =>
  applyLineAction(action, text.split('\n')).join('\n');
const bullet: LineAction = { kind: 'bullet' };
const ordered: LineAction = { kind: 'ordered' };
const task: LineAction = { kind: 'task' };
const quote: LineAction = { kind: 'quote' };
const h2: LineAction = { kind: 'heading', level: 2 };

test('the list buttons add, take off and convert markers', () => {
  assert.equal(lines(bullet, 'a\nb'), '- a\n- b');
  assert.equal(lines(bullet, '- a\n- b'), 'a\nb');
  assert.equal(lines(bullet, '1. a\n2. b'), '- a\n- b');
  assert.equal(lines(bullet, '- [ ] t'), '- t');
  assert.equal(lines(bullet, '- a\nb'), '- a\n- b');
  assert.equal(lines(ordered, 'a\nb'), '1. a\n2. b');
  assert.equal(lines(ordered, '1. a\n2. b'), 'a\nb');
  assert.equal(lines(ordered, '- a\n- b'), '1. a\n2. b');
  assert.equal(lines(ordered, '- [ ] t'), '1. t');
});

test('the task button adds a box to an item, and takes it off', () => {
  assert.equal(lines(task, 'buy milk'), '- [ ] buy milk');
  assert.equal(lines(task, '- buy milk'), '- [ ] buy milk');
  assert.equal(lines(task, '1. buy milk'), '1. [ ] buy milk');
  assert.equal(lines(task, '- [ ] a\n- [x] b'), 'a\nb');
  assert.equal(lines(task, '- [ ] a\nb'), '- [ ] a\n- [ ] b');
});

test('a marker goes after the indent and the quote', () => {
  assert.equal(lines(bullet, '  sub'), '  - sub');
  assert.equal(lines(bullet, '    code-like'), '    - code-like');
  assert.equal(lines(bullet, '> quoted'), '> - quoted');
  assert.equal(lines(bullet, '  - nested'), '  nested');
  assert.equal(lines(ordered, '> - a'), '> 1. a');
});

test('the quote button quotes, and unquotes what is all quoted', () => {
  assert.equal(lines(quote, 'a\n- b'), '> a\n> - b');
  assert.equal(lines(quote, '> a\n> > b'), 'a\n> b');
  assert.equal(lines(quote, '> a\nb'), '> > a\n> b');
});

test('a heading takes the place of a list item, inside its quote', () => {
  assert.equal(lines(h2, 'hello'), '## hello');
  assert.equal(lines(h2, '- item'), '## item');
  assert.equal(lines(h2, '  - [ ] nested task'), '## nested task');
  assert.equal(lines(h2, '> quoted'), '> ## quoted');
  assert.equal(lines(h2, '### smaller'), '## smaller');
  assert.equal(lines(h2, '#tag note'), '## #tag note');
});

test('blank lines in a selection stay blank', () => {
  assert.equal(lines(ordered, 'a\n\nb'), '1. a\n\n2. b');
  assert.equal(lines(bullet, 'a\n\nb'), '- a\n\n- b');
  assert.equal(lines(task, 'a\n\nb'), '- [ ] a\n\n- [ ] b');
  assert.equal(lines(h2, 'a\n\nb'), '## a\n\n## b');
  assert.equal(lines(bullet, '- a\n\n- b'), 'a\n\nb');
  // An empty line on its own is where a list is started.
  assert.equal(lines(bullet, ''), '- ');
  assert.equal(lines(ordered, ''), '1. ');
  assert.equal(lines(task, ''), '- [ ] ');
});

test('numbers count per nesting level', () => {
  assert.equal(lines(ordered, 'a\n  b'), '1. a\n  1. b');
  assert.equal(lines(ordered, 'a\n  b\n  c\nd'), '1. a\n  1. b\n  2. c\n2. d');
  assert.equal(lines(ordered, '- a\n  - b\n- c'), '1. a\n  1. b\n2. c');
  assert.equal(lines(ordered, '> a\n> b'), '> 1. a\n> 2. b');
});

test('a block goes after the paragraph, or after a new empty line at the end', () => {
  assert.deepEqual(appendBlockAt(['a', '', 'b'], 0, '```js\n```'), {
    at: { line: 1, ch: 0 },
    text: '\n```js\n```',
    line: 2,
  });
  // The end of the draft: the block starts two lines down, not three.
  assert.deepEqual(appendBlockAt(['hello'], 0, '```js\n```'), {
    at: { line: 0, ch: 5 },
    text: '\n\n```js\n```',
    line: 2,
  });
});

test('an empty fence over a selection wraps the selected lines', () => {
  const doc = 'intro\nconst a = 1\nconst b = 2\nend';
  const fenced = fenceSpan(doc.split('\n'), span(1, 3, 3, 0), '```js\n```');
  assert.ok(fenced);
  assert.equal(fenced.line, 1);
  assert.equal(
    result(doc, fenced.edit).text,
    'intro\n```js\nconst a = 1\nconst b = 2\n```\nend',
  );
  // A fence inside gets one of the other kind around it, the language name
  // still at the column the button selects; with both kinds, a longer one.
  const nested = fenceSpan(['```', 'x', '```'], span(0, 0, 2, 3), '```js\n```');
  assert.equal(nested?.edit.text, '~~~js\n```\nx\n```\n~~~');
  assert.equal(nested?.edit.text.slice(3, 5), 'js');
  const both = fenceSpan(['```', '~~~', 'x'], span(0, 0, 2, 1), '```js\n```');
  assert.equal(both?.edit.text, '````js\n```\n~~~\nx\n````');
  // Anything but an empty fence is not this.
  assert.equal(fenceSpan(['a'], span(0, 0, 0, 1), '$$\n\\TeX\n$$'), null);
  assert.equal(fenceSpan(['a'], span(0, 0, 0, 1), '```mermaid\ngraph TD\n```'), null);
});
