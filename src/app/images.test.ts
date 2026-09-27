import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imagePlaceholders } from './images.ts';
import type { HastNode } from './images.ts';

const img = (alt?: string): HastNode => ({
  type: 'element',
  tagName: 'img',
  properties: { src: 'https://example.com/a.png', ...(alt === undefined ? {} : { alt }) },
  children: [],
});

test('an image becomes a placeholder with its alt text and address', () => {
  const tree: HastNode = { type: 'root', children: [img('a diagram')] };
  imagePlaceholders(tree);
  assert.deepEqual(tree.children?.[0], {
    type: 'element',
    tagName: 'span',
    properties: { className: ['image-placeholder'], title: 'https://example.com/a.png' },
    children: [{ type: 'text', value: 'a diagram' }],
  });
});

test('images nested anywhere are replaced, and a missing alt still reads', () => {
  const link: HastNode = { type: 'element', tagName: 'a', children: [img()] };
  const tree: HastNode = {
    type: 'root',
    children: [{ type: 'element', tagName: 'p', children: [link] }],
  };
  imagePlaceholders(tree);
  const placeholder = link.children?.[0];
  assert.equal(placeholder?.tagName, 'span');
  assert.equal(placeholder?.children?.[0]?.value, 'image');
});

test('everything that is not an image is left alone', () => {
  const text: HastNode = { type: 'text', value: 'hello' };
  const tree: HastNode = { type: 'root', children: [text] };
  imagePlaceholders(tree);
  assert.equal(tree.children?.[0], text);
});
