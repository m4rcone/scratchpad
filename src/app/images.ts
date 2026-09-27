/** The slice of a hast node the image pass reads and writes. */
export interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  value?: string;
}

/**
 * Every image in a draft is remote — the sanitizer drops `data:` sources — and
 * the content security policy refuses remote images. An `<img>` would still
 * ask, though, and each refusal is an error in the console and under Errors in
 * `chrome://extensions`, repeated on every keystroke that re-renders the
 * preview. So no `<img>` is ever written: each becomes a placeholder carrying
 * its alt text, with the address on hover. This runs after the sanitizer, on
 * the tree it has already cleaned.
 */
export function imagePlaceholders(node: HastNode): void {
  node.children?.forEach((child, index, siblings) => {
    if (child.type !== 'element' || child.tagName !== 'img') {
      imagePlaceholders(child);
      return;
    }
    const alt = String(child.properties?.alt ?? '').trim();
    const src = String(child.properties?.src ?? '');
    siblings[index] = {
      type: 'element',
      tagName: 'span',
      properties: { className: ['image-placeholder'], title: src },
      children: [{ type: 'text', value: alt || 'image' }],
    };
  });
}
