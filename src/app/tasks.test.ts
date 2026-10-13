import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enableTaskBoxes, toggleTask } from './tasks.ts';
import type { HastNode } from './images.ts';

const box = (): HastNode => ({
  type: 'element',
  tagName: 'input',
  properties: { type: 'checkbox', checked: false, disabled: true },
  children: [],
});

test('a task box is enabled and told where its item starts', () => {
  const input = box();
  const tree: HastNode = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'ul',
        children: [
          {
            type: 'element',
            tagName: 'li',
            properties: { className: ['task-list-item'] },
            position: { start: { offset: 12 } },
            children: [input, { type: 'text', value: ' ship it' }],
          },
        ],
      },
    ],
  };
  enableTaskBoxes(tree);
  assert.equal(input.properties?.disabled, undefined);
  assert.equal(input.properties?.dataTaskAt, 12);
});

test('a checkbox outside a task item is left as it was', () => {
  const input = box();
  const tree: HastNode = { type: 'root', children: [input] };
  enableTaskBoxes(tree);
  assert.equal(input.properties?.disabled, true);
});

test('ticking writes an x between the brackets, and unticking a space', () => {
  const text = 'intro\n\n- [ ] one\n- [x] two\n3. [X] three';
  const one = text.indexOf('- [ ]');
  assert.deepEqual(toggleTask(text, one), { from: one + 3, to: one + 4, text: 'x' });
  const two = text.indexOf('- [x]');
  assert.deepEqual(toggleTask(text, two), { from: two + 3, to: two + 4, text: ' ' });
  const three = text.indexOf('3. [X]');
  assert.equal(toggleTask(text, three)?.text, ' ');
});

test('an offset that no longer lands on a task item ticks nothing', () => {
  assert.equal(toggleTask('- plain item', 0), null);
  assert.equal(toggleTask('- [ ] one', 3), null);
});
