import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import { strictDollars } from './dollars.ts';

interface Node {
  type: string;
  value?: string;
  children?: Node[];
}

const parser = unified().use(remarkParse).use(remarkMath).use(strictDollars);

/** The formulas in a line of markdown, in order. */
function formulas(markdown: string): string[] {
  const found: string[] = [];
  const walk = (node: Node): void => {
    if (node.type === 'inlineMath') found.push(node.value ?? '');
    node.children?.forEach(walk);
  };
  walk(parser.parse(markdown) as Node);
  return found;
}

test('reais are money, spaced or not', () => {
  assert.deepEqual(formulas('Essencial R$ 600–1.000  R$ 60–90'), []);
  assert.deepEqual(formulas('R$1.500–2.500 R$ 100–150'), []);
  assert.deepEqual(formulas('US$ 10 ou US$20'), []);
});

test('dollar amounts are money', () => {
  assert.deepEqual(formulas('costs $5 and $10'), []);
  assert.deepEqual(formulas('between $5 and $ 10'), []);
});

test('a dollar next to a space does not open or close a formula', () => {
  assert.deepEqual(formulas('$ x $'), []);
  assert.deepEqual(formulas('$x $'), []);
});

test('single-dollar formulas still render', () => {
  assert.deepEqual(formulas('$x$'), ['x']);
  assert.deepEqual(formulas('where $\\alpha + 1$ holds'), ['\\alpha + 1']);
  assert.deepEqual(formulas('($x$)'), ['x']);
  assert.deepEqual(formulas('R$ 5 for $x^2$'), ['x^2']);
});

test('a dollar followed by a digit does not close', () => {
  assert.deepEqual(formulas('$x$5'), []);
});

test('double dollars are left as remark-math has them', () => {
  assert.deepEqual(formulas('inline $$ x $$ here'), ['x']);
});
