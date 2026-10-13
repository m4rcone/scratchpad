/**
 * Find and replace inside the open draft, in a small panel floating at the
 * top right of the source, as editors usually have it: the query with its
 * count inside the field, a match-case toggle, previous and next, and the
 * replace row folded away behind a toggle until it is wanted.
 *
 * Chrome's own find cannot do this: CodeMirror draws only the lines near the
 * screen, so a word further down is simply not in the page to be found. The
 * search runs over the text instead, CodeMirror tints what is on screen, and
 * the bar keeps the count.
 *
 * The bar answers `⌘F`, which CodeMirror binds to a `find` command that is
 * never defined here, so the chord bubbles up to the page. Loading
 * CodeMirror's search addon would define it, and take the chord away.
 */
import type { Editor } from './editor.ts';
import { strings } from './strings.ts';

export interface Match {
  from: number;
  to: number;
}

/**
 * Text lowered one character at a time. A few characters change length when
 * lowered (`İ` becomes two), which shifts every offset after them; for a text
 * holding one, `at` says where each lowered unit starts and ends in the
 * original. `null` when nothing moved, which is nearly always.
 */
function lower(text: string): {
  text: string;
  at: { start: number[]; end: number[] } | null;
} {
  let lowered = '';
  for (const char of text) lowered += char.toLowerCase();
  if (lowered.length === text.length) return { text: lowered, at: null };
  const start: number[] = [];
  const end: number[] = [];
  let index = 0;
  for (const char of text) {
    const units = char.toLowerCase().length;
    for (let k = 0; k < units; k++) {
      start.push(index);
      end.push(index + char.length);
    }
    index += char.length;
  }
  return { text: lowered, at: { start, end } };
}

/**
 * Every occurrence of `query`, without overlaps, in any case unless
 * `matchCase`. Offsets are always in `text` as it is, even where lowering it
 * changed its length.
 */
export function findAll(
  text: string,
  query: string,
  matchCase = false,
  limit = 10000,
): Match[] {
  if (!query) return [];
  const haystack = matchCase ? { text, at: null } : lower(text);
  const needle = matchCase ? query : lower(query).text;
  const { at } = haystack;
  const matches: Match[] = [];
  let last = 0;
  for (
    let found = haystack.text.indexOf(needle);
    found >= 0 && matches.length < limit;
    found = haystack.text.indexOf(needle, found + needle.length)
  ) {
    const from = at ? at.start[found]! : found;
    const to = at ? at.end[found + needle.length - 1]! : found + needle.length;
    // A match that starts inside a character already matched is skipped.
    if (from < last) continue;
    matches.push({ from, to });
    last = to;
  }
  return matches;
}

/**
 * The match to stand on from `offset`: the first one starting there or after,
 * wrapping to the top past the last. `-1` when there is none at all.
 */
export function matchFrom(matches: Match[], offset: number): number {
  if (!matches.length) return -1;
  const index = matches.findIndex((match) => match.from >= offset);
  return index < 0 ? 0 : index;
}

/** One step forwards or back, wrapping at both ends. */
export function step(index: number, delta: number, total: number): number {
  if (!total) return -1;
  return (((index + delta) % total) + total) % total;
}

export interface Find {
  open(): void;
  close(): void;
  next(delta: number): void;
  /** The text or the draft may have changed under the bar: if so, count again. */
  refresh(): void;
}

/** Drawn on the toolbar's 48-unit grid, like the other icons the app adds. */
const icon = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 48 48" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const CHEVRON = icon('<path d="M18 12l12 12-12 12"/>');
const UP = icon('<path d="M24 38V10M12 22l12-12 12 12"/>');
const DOWN = icon('<path d="M24 10v28M12 26l12 12 12-12"/>');
const CLOSE = icon('<path d="M12 12l24 24M36 12L12 36"/>');

export function createFind(
  root: HTMLElement,
  editor: Editor,
  onClose: () => void,
  flash: (message: string) => void,
): Find {
  root.innerHTML = `
    <button type="button" class="find__icon find__toggle" data-action="toggle-replace"
            title="${strings.toggleReplace}" aria-label="${strings.toggleReplace}" aria-expanded="false">${CHEVRON}</button>
    <div class="find__rows">
      <div class="find__row">
        <label class="find__field">
          <input class="find__input" data-field="query" type="text" spellcheck="false" autocomplete="off"
                 placeholder="${strings.findPlaceholder}" aria-label="${strings.findPlaceholder}" />
          <span class="find__count" aria-live="polite"></span>
        </label>
        <button type="button" class="find__icon find__case" data-action="case"
                title="${strings.matchCase}" aria-label="${strings.matchCase}" aria-pressed="false">Aa</button>
        <button type="button" class="find__icon" data-action="prev" title="${strings.findPrev}" aria-label="${strings.findPrev}">${UP}</button>
        <button type="button" class="find__icon" data-action="next" title="${strings.findNext}" aria-label="${strings.findNext}">${DOWN}</button>
        <button type="button" class="find__icon" data-action="close" title="${strings.close}" aria-label="${strings.close}">${CLOSE}</button>
      </div>
      <div class="find__row find__replace" hidden>
        <label class="find__field">
          <input class="find__input" data-field="replacement" type="text" spellcheck="false" autocomplete="off"
                 placeholder="${strings.replacePlaceholder}" aria-label="${strings.replacePlaceholder}" />
        </label>
        <button type="button" class="find__button" data-action="replace">${strings.replaceOne}</button>
        <button type="button" class="find__button" data-action="replace-all">${strings.replaceAll}</button>
      </div>
    </div>`;

  const query = root.querySelector<HTMLInputElement>('[data-field="query"]')!;
  const replacement = root.querySelector<HTMLInputElement>('[data-field="replacement"]')!;
  const count = root.querySelector<HTMLElement>('.find__count')!;
  const replaceRow = root.querySelector<HTMLElement>('.find__replace')!;
  const toggle = root.querySelector<HTMLElement>('[data-action="toggle-replace"]')!;
  const caseButton = root.querySelector<HTMLElement>('[data-action="case"]')!;

  let matches: Match[] = [];
  let index = -1;
  let lastQuery: string | null = null;
  /** The text last counted, so a repaint that changed nothing counts nothing. */
  let lastText: string | null = null;
  /** Both choices last the session: closing the panel does not reset them. */
  let matchCase = false;
  let replacing = false;

  function paintCount() {
    root.classList.toggle('is-missing', !!query.value && !matches.length);
    count.textContent = query.value ? strings.findCount(index + 1, matches.length) : '';
  }

  /** Recounts; `from` is where to stand, `move` whether to select it. */
  function search(from: number, move: boolean) {
    const text = query.value;
    const key = `${matchCase}:${text}`;
    if (key !== lastQuery) {
      lastQuery = key;
      editor.highlight(text || null, matchCase);
    }
    lastText = editor.getText();
    matches = findAll(lastText, text, matchCase);
    index = matchFrom(matches, from);
    const match = matches[index] ?? null;
    editor.markCurrent(match);
    if (move && match) editor.select(match.from, match.to);
    paintCount();
  }

  function next(delta: number) {
    if (!matches.length) return;
    index = step(index, delta, matches.length);
    const match = matches[index]!;
    editor.markCurrent(match);
    editor.select(match.from, match.to);
    paintCount();
  }

  function replaceOne() {
    const match = matches[index];
    if (!match) return;
    editor.replace([match], replacement.value);
    // Carry on from just past what was written, so a replacement that still
    // contains the query is not found again on the spot.
    search(match.from + replacement.value.length, true);
  }

  function replaceAll() {
    if (!matches.length) return;
    const total = matches.length;
    editor.replace(matches, replacement.value);
    search(0, false);
    flash(strings.replaced(total));
  }

  function setReplacing(open: boolean) {
    replacing = open;
    replaceRow.hidden = !open;
    root.classList.toggle('is-replacing', open);
    toggle.setAttribute('aria-expanded', String(open));
  }

  root.addEventListener('input', (event) => {
    if (event.target === query) search(editor.selection().from, true);
  });

  root.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')
      ?.dataset.action;
    if (action === 'prev') next(-1);
    else if (action === 'next') next(1);
    else if (action === 'replace') replaceOne();
    else if (action === 'replace-all') replaceAll();
    else if (action === 'close') onClose();
    else if (action === 'case') {
      matchCase = !matchCase;
      caseButton.setAttribute('aria-pressed', String(matchCase));
      search(editor.selection().from, false);
    } else if (action === 'toggle-replace') {
      setReplacing(!replacing);
      (replacing ? replacement : query).focus();
    }
  });

  // Kept inside the panel: escape and enter mean something else to the page.
  root.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (
      event.key === 'Enter' &&
      (event.target as HTMLElement).tagName === 'INPUT'
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (event.target === replacement) {
        if (event.metaKey || event.ctrlKey) replaceAll();
        else replaceOne();
      } else next(event.shiftKey ? -1 : 1);
    }
  });

  return {
    open() {
      // Whatever is selected in the source, on one line, is what to look for.
      const { from, to } = editor.selection();
      const selected = editor.getText().slice(from, to);
      if (selected && !selected.includes('\n')) query.value = selected;
      lastQuery = null;
      search(from, false);
      query.focus();
      query.select();
    },
    close() {
      editor.highlight(null, false);
      editor.markCurrent(null);
      lastQuery = null;
      lastText = null;
      matches = [];
      index = -1;
    },
    next,
    refresh() {
      // The page repaints on every change to the store, most of which leave
      // the text alone; the query has its own listener.
      if (editor.getText() === lastText) return;
      search(editor.selection().from, false);
    },
  };
}
