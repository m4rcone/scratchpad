/**
 * The ByteMD plugin set, and the only place that decides what markdown means
 * here. Each entry is a dependency with a weight, so the list is short on
 * purpose.
 *
 * The list is rebuilt when the theme changes, because mermaid bakes colours
 * into the SVG it draws and cannot be restyled from CSS afterwards.
 */
import type { BytemdPlugin } from 'bytemd';
import breaks from '@bytemd/plugin-breaks';
import gemoji from '@bytemd/plugin-gemoji';
import gfm from '@bytemd/plugin-gfm';
import highlight from '@bytemd/plugin-highlight-ssr';
import math from '@bytemd/plugin-math';
import mermaid from '@bytemd/plugin-mermaid';
import { imagePlaceholders } from './images.ts';
import type { HastNode } from './images.ts';

// KaTeX's own stylesheet. The maths engine itself is behind a dynamic import
// inside the plugin, so it only loads when a draft actually contains maths.
import 'katex/dist/katex.min.css';

/** See `images.ts`: the preview never writes an `<img>` the policy would refuse. */
const noRemoteImages: BytemdPlugin = {
  rehype: (processor) =>
    processor.use(() => (tree: unknown) => imagePlaceholders(tree as HastNode)),
};

export function markdownPlugins(theme: 'dark' | 'light'): BytemdPlugin[] {
  return [
    gfm(),
    // `ignoreMissing` keeps ```klingon from throwing: an unknown language is
    // a plain block, not an error in the middle of someone's notes.
    highlight({ ignoreMissing: true }),
    math(),
    mermaid({ theme: theme === 'dark' ? 'dark' : 'default' }),
    breaks(),
    gemoji(),
    noRemoteImages,
  ];
}
