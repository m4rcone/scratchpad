/**
 * Escaping for the chrome around the editor — rail rows, search results — where
 * a draft's own text is interpolated into markup we build by hand.
 *
 * The markdown itself no longer passes through here: ByteMD parses it and
 * sanitises the result with `hast-util-sanitize`, so the preview is the only
 * place a draft becomes rich HTML, and it is ByteMD that decides what survives.
 */
import { fold } from './model.ts';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Escapes `text` and wraps each occurrence of `query` in `<mark>`, matching
 * the way search does: any case, with or without accents. The match is found
 * in the folded text and marked in the original, accents and all.
 */
export function markMatches(text: string, query: string): string {
  const needle = fold(query.trim()).text;
  if (!needle) return escapeHtml(text);
  const { text: haystack, at } = fold(text);
  let html = '';
  let from = 0;
  for (
    let found = haystack.indexOf(needle);
    found >= 0;
    found = haystack.indexOf(needle, found + needle.length)
  ) {
    const start = at[found]!;
    const end = at[found + needle.length]!;
    // A match that starts inside a character already marked is skipped.
    if (start < from) continue;
    html += escapeHtml(text.slice(from, start));
    html += `<mark>${escapeHtml(text.slice(start, end))}</mark>`;
    from = end;
  }
  return html + escapeHtml(text.slice(from));
}

/**
 * Keyboard hints as key caps beside what they do — `↵ delete  esc keep` —
 * so a hint reads as keys and actions rather than a sentence strung together
 * with separators.
 */
export function keyHints(pairs: [string, string][]): string {
  return pairs
    .map(
      ([key, label]) =>
        `<span class="key-hint"><kbd>${escapeHtml(key)}</kbd>${escapeHtml(label)}</span>`,
    )
    .join('');
}

/**
 * A control's label with its key in front, as every hint in the app reads:
 * `esc close`. Where there is no keyboard the key is '' and only the words
 * are left.
 */
export function withKey(key: string, label: string): string {
  return key ? keyHints([[key, label]]) : escapeHtml(label);
}
