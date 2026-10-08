/**
 * Scratchpad page: wiring only.
 *
 * Order still matters, but it no longer buys the first character: ByteMD's
 * editor is a component, so it exists once its module has run. What is kept is
 * that nothing waits on IndexedDB — the editor is mounted and focused before
 * the disk is asked, and whatever gets typed while it answers survives (see
 * `store.load`).
 */
import 'bytemd/dist/index.css';
import './bytemd.css';

import { createEditor } from '../app/editor.ts';
import { createFooter } from '../app/footer.ts';
import { createRail } from '../app/rail.ts';
import { createSearch, searchResults } from '../app/search.ts';
import { createStore } from '../app/store.ts';
import type { State } from '../app/store.ts';
import { isTextFile, slugOf, titleOf } from '../app/model.ts';
import { isMod } from '../app/platform.ts';
import { strings } from '../app/strings.ts';
import { applyTheme, bootTheme, effectiveTheme, systemTheme } from '../app/theme.ts';
import { indexedDbStore } from '../storage/indexeddb.ts';
import { prefsStore } from '../storage/prefs.ts';
import type { Draft } from '../storage/types.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const topbarEl = $('topbar');
const railEl = $('rail');
const footerEl = $('footer');
const searchEl = $('search');
const editorEl = $('editor');
const shellEl = document.querySelector<HTMLElement>('.shell')!;

// A pinned theme is known synchronously, so the first frame is already right —
// and so is the palette mermaid bakes into the diagrams it draws.
const theme = bootTheme();
applyTheme(theme);

const store = createStore(indexedDbStore(), prefsStore(), theme);
const editor = createEditor(editorEl, store.state.mode, effectiveTheme(theme));
editor.focus();

const paintRail = createRail(railEl);
const paintFooter = createFooter(footerEl);
const search = createSearch(searchEl);
const railButton = topbarEl.querySelector<HTMLElement>('[data-action="rail"]')!;
const modeButton = topbarEl.querySelector<HTMLElement>('[data-action="mode"]')!;
railButton.textContent = strings.draftsButton;

let results: Draft[] = [];
let lastRenderedId: string | null = null;
let lastMode = store.state.mode;
let lastTheme = effectiveTheme(theme);
let searchWasOpen = false;

function paint(state: State): void {
  const active = store.active();
  const switched = !!active && active.id !== lastRenderedId;

  // Only reset the document when the draft itself changed: rewriting it on
  // every keystroke would fight the caret and wipe CodeMirror's undo history.
  if (active && active.id !== lastRenderedId) {
    editor.setText(active.text, active.caret);
    lastRenderedId = active.id;
  }
  if (!active && lastRenderedId) {
    editor.setText('');
    lastRenderedId = null;
  }

  searchEl.hidden = !state.searchOpen;
  const wasHidden = editorEl.hidden;
  editorEl.hidden = state.searchOpen;
  // Coming back from search, the editor has just regained a size. Anything
  // `setText` wrote above landed while it had none, so CodeMirror is asked to
  // measure again now — synchronously, so the draft is right on the same frame
  // it reappears rather than a blink later.
  if (wasHidden && !editorEl.hidden) editor.refresh();

  if (state.searchOpen) {
    results = searchResults(state);
    search.render(state, results);
    if (!searchWasOpen) search.focus();
  }
  searchWasOpen = state.searchOpen;

  const modeChanged = state.mode !== lastMode;
  if (modeChanged) {
    lastMode = state.mode;
    editor.setMode(state.mode);
  }
  // Arriving at the reading view, or at another draft while in it, picks the
  // reading up where it was left.
  if (active && state.mode === 'read' && (modeChanged || switched)) {
    editor.setReadScroll(active.scroll ?? 0);
  }

  applyTheme(state.theme);
  const nowTheme = effectiveTheme(state.theme);
  if (nowTheme !== lastTheme) {
    lastTheme = nowTheme;
    editor.setTheme(nowTheme);
  }

  // From either view, the top bar's button is the way back to the text.
  modeButton.textContent = state.mode === 'write' ? strings.splitView : strings.writeOnly;
  // The tab strip and the history show which draft this is.
  const title = active ? titleOf(active.text) : '';
  document.title = title ? `${title} · ${strings.appName}` : strings.appName;
  paintRail(state);
  paintFooter(state, editor.getText());
}

store.subscribe(paint);

editor.onInput((text, caret) => store.write(text, caret));
editor.onCaret((caret) => store.moveCaret(caret));
// Coming back to the text means the delete was not meant: enter must type a
// newline again, not confirm.
editor.onFocus(() => store.cancelDelete());
editor.onReadScroll((fraction) => store.moveScroll(fraction));
editor.onToggleView(toggleMode);

// ---------- actions ----------

async function copyAll(): Promise<void> {
  try {
    await navigator.clipboard.writeText(editor.getText());
    store.flash(strings.copied);
  } catch {
    // Clipboard denied: select the draft instead, so ⌘C is one key away.
    editor.selectAll();
  }
}

function exportDraft(): void {
  const text = editor.getText();
  const name = `${slugOf(text)}.md`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // Revoking in the same tick can cancel the download it just started.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  store.flash(strings.exported(name));
}

function deleteDraft(): void {
  if (store.requestDelete() === 'deleted') {
    // An empty draft goes without an undo offer, so it gets a plain notice.
    if (!store.state.deleted) store.flash(strings.deletedEmpty);
    editor.focus();
  }
}

function undoDelete(): void {
  if (store.undoRemove()) editor.focus();
}

/**
 * Each dropped `.md` or `.txt` becomes a draft of its own; the last one is left
 * open. Nothing else is taken, and the footer says so rather than leaving the
 * writer to wonder why the drop did nothing.
 */
async function openFiles(files: File[]): Promise<void> {
  const accepted = files.filter((file) => isTextFile(file.name));
  if (!accepted.length) {
    store.flash(strings.dropOnly);
    return;
  }
  // A drop in the first instants must not land in drafts the load then replaces.
  await booted;
  const texts = await Promise.all(accepted.map((file) => file.text()));
  for (const text of texts) store.create(text.replace(/\r\n?/g, '\n'));
  editor.focus();
  store.flash(
    accepted.length < files.length ? strings.dropOnly : strings.dropped(texts.length),
  );
}

/**
 * Flips what is on screen. Landing on the system's own theme un-pins the
 * choice instead of pinning it, so the page follows the system again — the
 * only way back to "system" without a third state on the button.
 */
function toggleTheme(): void {
  const next = effectiveTheme(store.state.theme) === 'dark' ? 'light' : 'dark';
  store.setTheme(next === systemTheme() ? 'system' : next);
}

/** Leaving a view for `write` hands the caret straight back to the text. */
function toggleMode(mode: 'split' | 'read'): void {
  store.toggleMode(mode);
  if (store.state.mode === 'write') editor.focus();
}

function backToWriting(): void {
  store.setMode('write');
  editor.focus();
}

function openDraft(id: string): void {
  store.open(id);
  editor.focus();
}

function createDraft(): void {
  store.create();
  editor.focus();
}

function closeSearch(): void {
  store.setSearch(false);
  editor.focus();
}

// ---------- events ----------

const actionOf = (event: Event): string | undefined =>
  (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;

topbarEl.addEventListener('click', (event) => {
  const action = actionOf(event);
  if (action === 'rail') store.setRail(!store.state.railOpen);
  else if (action === 'mode') {
    if (store.state.mode === 'write') toggleMode('split');
    else backToWriting();
  }
});

railEl.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-id],[data-action]',
  );
  if (!target) return;
  if (target.dataset.id) openDraft(target.dataset.id);
  else if (target.dataset.action === 'new') createDraft();
  else if (target.dataset.action === 'search') store.setSearch(true);
  else if (target.dataset.action === 'close') store.setRail(false);
});

footerEl.addEventListener('click', (event) => {
  const action = actionOf(event);
  if (action === 'copy') void copyAll();
  else if (action === 'export') exportDraft();
  else if (action === 'delete') deleteDraft();
  else if (action === 'undo') undoDelete();
  else if (action === 'theme') toggleTheme();
});

searchEl.addEventListener('input', (event) => {
  const input = event.target as HTMLInputElement;
  if (input.classList.contains('search__input')) store.setQuery(input.value);
});

searchEl.addEventListener('click', (event) => {
  const id = (event.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id;
  if (id) openDraft(id);
  else if (actionOf(event) === 'close') closeSearch();
});

searchEl.addEventListener('mousemove', (event) => {
  const index = (event.target as HTMLElement).closest<HTMLElement>('[data-index]')
    ?.dataset.index;
  if (index !== undefined && store.state.cursor !== Number(index)) {
    store.moveCursor(Number(index) - store.state.cursor, results.length);
  }
});

// The footer's theme label — and mermaid's palette — follow the system when
// nothing is pinned.
window
  .matchMedia('(prefers-color-scheme: light)')
  .addEventListener('change', () => paint(store.state));

/**
 * Every chord here is deliberately one ByteMD and CodeMirror leave alone.
 *
 * Both register keymaps on the editor element, which sees a key before this
 * listener does, so a shared chord is simply lost: ⌘K writes a link, ⌘⇧C
 * writes a code block, ⌘D deletes a line. Rather than race them from the
 * capture phase, the app moved to shift-chords none of them claim — ⌘⇧F,
 * ⌘⇧D, ⌘⇧A, ⌘⇧P — and CodeMirror lets those bubble up untouched. Adding a
 * shortcut means checking both keymaps first; `⌘S` survives only because the
 * `save` command CodeMirror binds it to is never defined.
 */
window.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  const state = store.state;
  const key = event.key.toLowerCase();

  if (isMod(event)) {
    if (key === 'f' && event.shiftKey) {
      event.preventDefault();
      if (state.searchOpen) closeSearch();
      else store.setSearch(true);
    } else if (event.key === '/') {
      // `/` sits on a shifted key on some layouts, so shift is not checked here.
      event.preventDefault();
      toggleMode('split');
    } else if (key === 'p' && event.shiftKey) {
      event.preventDefault();
      toggleMode('read');
    } else if (key === 'd' && event.shiftKey) {
      event.preventDefault();
      createDraft();
    } else if (key === 'a' && event.shiftKey) {
      event.preventDefault();
      void copyAll();
    } else if (key === 's' && !event.shiftKey) {
      event.preventDefault();
      exportDraft();
    }
    return;
  }

  if (state.searchOpen) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      store.moveCursor(1, results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      store.moveCursor(-1, results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = results[store.state.cursor];
      if (chosen) openDraft(chosen.id);
    }
    return;
  }

  if (state.railOpen && event.key === 'Escape') {
    event.preventDefault();
    store.setRail(false);
    return;
  }

  if (state.pendingDelete) {
    if (event.key === 'Enter') {
      event.preventDefault();
      deleteDraft();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      store.cancelDelete();
    }
    return;
  }

  if (state.deleted && event.key === 'Escape') {
    event.preventDefault();
    undoDelete();
    return;
  }

  if (event.key === 'Escape' && state.mode !== 'write') {
    event.preventDefault();
    backToWriting();
  }
});

/**
 * Files dropped anywhere on the page. Listened to in the capture phase, ahead
 * of CodeMirror: left to itself it pastes any dropped file's bytes into the
 * open draft — an image included — and outside the editor Chrome would leave
 * the scratchpad to display the file. A drag that carries no files (text moved
 * inside the editor) is none of this code's business.
 */
const carriesFiles = (event: DragEvent) =>
  event.dataTransfer?.types.includes('Files') ?? false;
// `dragleave` fires on every child the drag crosses, so the cue counts depth.
let dragDepth = 0;

window.addEventListener(
  'dragenter',
  (event) => {
    if (!carriesFiles(event)) return;
    dragDepth += 1;
    shellEl.dataset.dropping = '';
  },
  true,
);
window.addEventListener(
  'dragleave',
  (event) => {
    if (!carriesFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) delete shellEl.dataset.dropping;
  },
  true,
);
window.addEventListener(
  'dragover',
  (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer!.dropEffect = 'copy';
  },
  true,
);
window.addEventListener(
  'drop',
  (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth = 0;
    delete shellEl.dataset.dropping;
    void openFiles([...(event.dataTransfer?.files ?? [])]);
  },
  true,
);

// Closing the tab right after a keystroke must not cost that keystroke.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    store.flushSync();
    void store.flush();
  }
});
window.addEventListener('pagehide', () => store.flushSync());

// ---------- boot ----------

const booted = store
  .load(() => editor.getText())
  .then((active) => {
    if (active) {
      editor.setText(active.text, active.caret);
      lastRenderedId = active.id;
    }
    paint(store.state);
    editor.focus();
  });

paint(store.state);
