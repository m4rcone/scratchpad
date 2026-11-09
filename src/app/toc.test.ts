import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentHeading, headingLine, markHeadings } from './toc.ts';
import type { HastNode } from './images.ts';

const text = (value: string): HastNode => ({ type: 'text', value });
const heading = (tagName: string, at: number, children = [text('x')]): HastNode => ({
  type: 'element',
  tagName,
  properties: {},
  position: { start: { offset: at } },
  children,
});

test('the top-level headings with text are marked with where they start', () => {
  const alpha = heading('h1', 0);
  const beta = heading('h2', 20);
  const tree: HastNode = { type: 'root', children: [alpha, text('\n'), beta] };
  markHeadings(tree);
  assert.equal(alpha.properties?.dataHeadingAt, 0);
  assert.equal(beta.properties?.dataHeadingAt, 20);
});

test('a heading in a quote or an empty one is not an entry, and is not marked', () => {
  const quoted = heading('h2', 12);
  const empty = heading('h3', 30, []);
  const quote: HastNode = {
    type: 'element',
    tagName: 'blockquote',
    properties: {},
    children: [quoted],
  };
  const tree: HastNode = { type: 'root', children: [quote, empty] };
  markHeadings(tree);
  assert.equal(quoted.properties?.dataHeadingAt, undefined);
  assert.equal(empty.properties?.dataHeadingAt, undefined);
});

test('other elements are left alone', () => {
  const paragraph = heading('p', 5);
  markHeadings({ type: 'root', children: [paragraph] });
  assert.equal(paragraph.properties?.dataHeadingAt, undefined);
});

test('the current entry is the last heading at or above the top', () => {
  assert.equal(currentHeading([0, 100, 200], 150), 1);
  assert.equal(currentHeading([0, 100, 200], 200), 2);
  assert.equal(currentHeading([0, 100, 200], 999), 2);
});

test('above every heading, the first entry is the current one', () => {
  assert.equal(currentHeading([50, 100], 0), 0);
  assert.equal(currentHeading([], 0), 0);
});

test('an offset on a heading leads to its own line', () => {
  assert.equal(headingLine(['# One', '', 'text', '## Two'], 3), 3);
});

test('an offset a little off leads to the nearest heading', () => {
  const lines = ['# One', '', 'text', 'more', '', '## Two', 'after'];
  assert.equal(headingLine(lines, 4), 5);
  assert.equal(headingLine(lines, 6), 5);
});

test('a heading in a quote or a list, or a #tag, is not one to land on', () => {
  const lines = ['> ## Quoted', '- # listed', '#tag', 'text', '## Real'];
  assert.equal(headingLine(lines, 1), 4);
});

test('with no heading in reach, the line itself', () => {
  const lines = Array.from({ length: 60 }, () => 'text');
  assert.equal(headingLine(lines, 30), 30);
});
