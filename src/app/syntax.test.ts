import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blankFrontMatter,
  frontMatterLines,
  parseLine,
  readFence,
  readFrontMatter,
} from './syntax.ts';

test('a line is read into its quote, indent, marker, box and heading', () => {
  assert.deepEqual(parseLine('> - [x] ## done'), {
    quote: '> ',
    indent: '',
    marker: '-',
    box: 'x',
    heading: 2,
    body: 'done',
    rest: '## done',
  });
  assert.equal(parseLine('  12) item').marker, '12)');
  assert.equal(parseLine('  12) item').indent, '  ');
  assert.equal(parseLine('**bold**').marker, null);
  assert.equal(parseLine('1.5 litres').marker, null);
  assert.equal(parseLine('#tag note').heading, 0);
  assert.equal(parseLine('---').marker, null);
});

test('front matter is read as the preview reads it', () => {
  assert.equal(frontMatterLines('---\ntitle: x\n---\n# body'), 3);
  assert.equal(frontMatterLines('--- \na: 1\n---  \nbody'), 3);
  assert.equal(frontMatterLines('---\r\na: 1\r\n---\r\nbody'), 3);
  assert.equal(
    frontMatterLines(
      '---\n# a comment\nname: x\ntags:\n- one\n  - two\n\ndescription: |\n  text\n---\nbody',
    ),
    10,
  );
  // No closing fence, a longer opening one, or anything before it: a rule.
  assert.equal(frontMatterLines('---\nbody text\nmore'), 0);
  assert.equal(frontMatterLines('----\na: 1\n---\nb'), 0);
  assert.equal(frontMatterLines('\n---\na: 1\n---\nb'), 0);
  assert.equal(frontMatterLines('---'), 0);
  assert.equal(frontMatterLines('plain'), 0);
});

test('a rule that opens the draft is not front matter', () => {
  // Two rules in a row, or a capitalised label between two, are prose.
  assert.equal(frontMatterLines('---\n---\nbody'), 0);
  assert.equal(frontMatterLines('---\nTODO: fix the build\n---\nmore'), 0);
  assert.equal(frontMatterLines('---\nWeek two: notes\n---\nmore'), 0);
  // A capitalised key beside a lowercase one is still YAML.
  assert.equal(frontMatterLines('---\nTitle: x\ntags: [a]\n---\nmore'), 4);
  // Rules used as separators: what lies between them is prose, not YAML.
  assert.equal(frontMatterLines('---\n# Week 1\nnotes\n\n---\n# Week 2'), 0);
  assert.equal(frontMatterLines('---\n# Week 1\n\n---\n# Week 2'), 0);
  // A `---` in a code sample further down does not close anything.
  assert.equal(frontMatterLines('---\nSee:\n```yaml\na: 1\n---\n```'), 0);
  // A line the editor would end front matter at is the fence or no YAML.
  assert.equal(frontMatterLines('---\na: 1\n----\nb\n---\nc'), 0);
  assert.equal(frontMatterLines('---\na: 1\n...\nb: 2\n---'), 0);
  assert.equal(frontMatterLines('---\na: 1\n---x\n---'), 0);
});

test('the preview reads the front matter as blank lines, offsets kept', () => {
  const text = '---\ntitle: x\n---\n# body';
  const blank = blankFrontMatter(text);
  assert.equal(blank, '   \n        \n   \n# body');
  assert.equal(blank.length, text.length);
  // HTML or a fence in a block scalar stays inside it: it is blank too.
  assert.equal(
    blankFrontMatter('---\nd: |\n  <details>\n---\ntext'),
    '   \n    \n           \n   \ntext',
  );
  assert.equal(blankFrontMatter('---\r\na: 1\r\n---\r\nb'), '   \r\n    \r\n   \r\nb');
  assert.equal(blankFrontMatter('---\na: 1\n---'), '   \n    \n   ');
  // A rule that opens the draft is left as it is.
  assert.equal(blankFrontMatter('---\n\n- item'), '---\n\n- item');
});

test('front matter is named by its title, or its name', () => {
  assert.deepEqual(readFrontMatter('---\nname: a\ntitle: "T"\n---\nbody'), {
    lines: 4,
    name: 'T',
  });
  assert.deepEqual(readFrontMatter('---\nname: skill\n---'), { lines: 3, name: 'skill' });
  assert.deepEqual(readFrontMatter('---\ndate: today\n---'), { lines: 3, name: '' });
  assert.deepEqual(readFrontMatter('---\ntitle: x\n'), { lines: 0, name: '' });
});

test('a title in front matter loses its quotes and its comment', () => {
  const nameOf = (yaml: string) => readFrontMatter(`---\n${yaml}\n---`).name;
  assert.equal(nameOf('title: My post # draft'), 'My post');
  assert.equal(nameOf('title: "Quoted" # c'), 'Quoted');
  assert.equal(nameOf("title: 'it # stays'"), 'it # stays');
  assert.equal(nameOf('title: C# in a week'), 'C# in a week');
  assert.equal(nameOf('title: # only a comment\nname: fallback'), 'fallback');
  assert.equal(nameOf('title: >\n  folded'), '');
});

test('a fence is read with its run and its info string', () => {
  assert.deepEqual(readFence('```js'), { run: '```', info: 'js' });
  assert.deepEqual(readFence('   ~~~~'), { run: '~~~~', info: '' });
  assert.equal(readFence('    ```'), null);
  assert.equal(readFence('``` a`b'), null);
  assert.equal(readFence('``'), null);
});
