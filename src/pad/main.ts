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

import {
  backupName,
  draftsFromArchive,
  exportName,
  markdownEntries,
  readBackup,
  writeBackup,
} from '../app/backup.ts';
import { createEditor } from '../app/editor.ts';
import logo from '../app/logo.svg?raw';
import { createFind } from '../app/find.ts';
import { createFooter } from '../app/footer.ts';
import { createRail } from '../app/rail.ts';
import { createSearch, searchResults } from '../app/search.ts';
import { createSettings } from '../app/settings.ts';
import type { PendingRestore } from '../app/settings.ts';
import { createStore } from '../app/store.ts';
import type { State } from '../app/store.ts';
import { isArchive, isBackupFile, isTextFile, slugOf, titleOf } from '../app/model.ts';
import { isMod, isTouch, scrollbarWidth, shortcutKey } from '../app/platform.ts';
import { strings } from '../app/strings.ts';
import { applyTheme, bootTheme, effectiveTheme, systemTheme } from '../app/theme.ts';
import { readZip, writeZip } from '../app/zip.ts';
import { broadcastSync } from '../storage/broadcast.ts';
import { indexedDbStore } from '../storage/indexeddb.ts';
import { prefsStore } from '../storage/prefs.ts';
import type { Draft } from '../storage/types.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const topbarEl = $('topbar');
const railEl = $('rail');
const footerEl = $('footer');
const searchEl = $('search');
const editorEl = $('editor');
const findEl = $('find');
const hintsEl = $('hints');
const settingsEl = $('settings');
const shellEl = document.querySelector<HTMLElement>('.shell')!;

// A pinned theme is known synchronously, so the first frame is already right —
// and so is the palette mermaid bakes into the diagrams it draws.
const theme = bootTheme();
applyTheme(theme);

const store = createStore(indexedDbStore(), prefsStore(), theme, broadcastSync());
const editor = createEditor(editorEl, store.state.mode, effectiveTheme(theme));
editor.focus();
const find = createFind(findEl, editor, closeFind, (message) => store.flash(message));

/**
 * The toolbar and the footer float over the text, translucent, so the writing
 * shows through as it scrolls under them. The text is padded by their heights
 * — measured, since the toolbar takes two rows on a phone — so its first and
 * last lines still clear them, and the caret is kept that far from either
 * edge while typing.
 */
const columnEl = document.querySelector<HTMLElement>('.column')!;
const toolbarEl = editorEl.querySelector<HTMLElement>('.bytemd-toolbar');
const measureBars = () => {
  const top = toolbarEl?.offsetHeight ?? 44;
  const bottom = footerEl.offsetHeight;
  columnEl.style.setProperty('--toolbar-h', `${top}px`);
  columnEl.style.setProperty('--footer-h', `${bottom}px`);
  editor.setCaretMargin(Math.max(top, bottom) + 8);
};
const barObserver = new ResizeObserver(measureBars);
barObserver.observe(footerEl);
if (toolbarEl) barObserver.observe(toolbarEl);

// The find panel floats over the top of the text as well. Where it ends is
// measured so the text can start below it while it is open: the first line,
// a title most often, would otherwise sit under it with nowhere to scroll.
new ResizeObserver(() => {
  if (findEl.hidden) return;
  columnEl.style.setProperty(
    '--find-bottom',
    `${findEl.offsetTop + findEl.offsetHeight}px`,
  );
}).observe(findEl);

/**
 * Scrollbars that take a column of their own (Windows, Linux) would run under
 * the floating bars, their ends and arrows hidden. Where there are such
 * scrollbars the stylesheet thins them and keeps the bars off them; the
 * width is measured after thinning, since that is the width they keep.
 */
if (scrollbarWidth() > 0) {
  document.documentElement.dataset.scrollbars = 'classic';
  document.documentElement.style.setProperty('--scrollbar-w', `${scrollbarWidth()}px`);
}

const paintRail = createRail(railEl);
const footer = createFooter(footerEl);
const search = createSearch(searchEl);
// Outside the extension (vite dev) there is no manifest to read a version from.
const version =
  typeof chrome !== 'undefined' ? (chrome.runtime?.getManifest?.().version ?? '') : '';
const storeId = typeof chrome !== 'undefined' ? (chrome.runtime?.id ?? '') : '';
const paintSettings = createSettings(settingsEl, version, storeId);
/** A backup that was read and is waiting for the writer to say "restore". */
let pendingRestore: PendingRestore | null = null;
/**
 * One file picker for the settings' two buttons, kept outside the panel's
 * markup, which is rebuilt; what it accepts is set by the button that opens it.
 */
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.hidden = true;
document.body.append(fileInput);
const railButton = topbarEl.querySelector<HTMLElement>('[data-action="rail"]')!;
/** What the drafts button flags, so it is drawn again only when that changes. */
let railFlag: boolean | null = null;
/**
 * On a narrow window the rail, and the news flag at its foot, are behind the
 * drafts button; it carries the same dot, so it is not out of sight.
 */
function paintRailButton(state: State): void {
  const flag = Boolean(state.whatsNew) && !state.settingsOpen;
  if (flag === railFlag) return;
  railFlag = flag;
  railButton.innerHTML = flag
    ? `${strings.draftsButton}<span class="topbar__flag" aria-hidden="true"></span><span class="visually-hidden">, ${strings.newsFlag}</span>`
    : strings.draftsButton;
}
// On a narrow window the rail, and the logo at its head, are tucked away; the
// top bar carries the logo instead, in the same dimmed ink.
topbarEl.insertAdjacentHTML(
  'afterbegin',
  `<span class="topbar__logo" aria-hidden="true">${logo}</span>`,
);

let results: Draft[] = [];
let lastRenderedId: string | null = null;
let lastMode = store.state.mode;
let lastTheme = effectiveTheme(theme);
let searchWasOpen = false;
let lastReplaced = store.state.replaced;
let findWasOpen = false;
let settingsWasOpen = false;

function paint(state: State): void {
  const active = store.active();
  const switched = !!active && active.id !== lastRenderedId;

  // Only reset the document when the draft itself changed — another draft, or
  // this one rewritten by another tab or a restore: rewriting it on every
  // keystroke would fight the caret and wipe CodeMirror's undo history.
  if (active && (switched || state.replaced !== lastReplaced)) {
    editor.setText(active.text, active.caret);
    lastRenderedId = active.id;
  }
  lastReplaced = state.replaced;
  if (!active && lastRenderedId) {
    editor.setText('');
    lastRenderedId = null;
  }

  searchEl.hidden = !state.searchOpen;
  settingsEl.hidden = !state.settingsOpen;
  if (!state.settingsOpen) pendingRestore = null;
  paintSettings(state, pendingRestore);
  // Into the panel with the keyboard, so tab and escape work from the start.
  if (state.settingsOpen && !settingsWasOpen) {
    settingsEl.querySelector<HTMLElement>('[data-action="backup"]')?.focus();
  }
  settingsWasOpen = state.settingsOpen;
  const covered = state.searchOpen || state.settingsOpen;
  const wasHidden = editorEl.hidden;
  editorEl.hidden = covered;
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

  findEl.hidden = !state.findOpen || covered;
  if (state.findOpen && !covered) find.refresh();
  if (findWasOpen && !state.findOpen) find.close();
  findWasOpen = state.findOpen;

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

  // The tab strip and the history show which draft this is.
  const title = active ? titleOf(active.text) : '';
  document.title = title ? `${title} – ${strings.appName}` : strings.appName;
  paintRail(state);
  paintRailButton(state);
  // An empty draft says what can be done with it; the first keystroke, or
  // anything else on screen, sends the hints away.
  hintsEl.hidden =
    isTouch ||
    !state.loaded ||
    !active ||
    !!active.text ||
    state.mode === 'read' ||
    covered ||
    state.findOpen;
  footer.paint(state, editor.getText());
}

hintsEl.innerHTML = `
  <div class="hints__keys">
    ${strings.emptyKeys.map(([keys, label]) => `<kbd>${keys}</kbd><span>${label}</span>`).join('')}
  </div>`;

// What a file dragged over the page will become, said while it is still in
// the air. It is painted over everything but takes no pointer events, so the
// drop still lands on the window listeners below.
const dropHint = document.createElement('div');
dropHint.className = 'drop-hint';
dropHint.setAttribute('aria-hidden', 'true');
dropHint.innerHTML = `<div><strong>${strings.dropTitle}</strong>${strings.dropDetail.map((line) => `<span>${line}</span>`).join('')}</div>`;
shellEl.append(dropHint);

store.subscribe(paint);

editor.onInput((text, caret) => store.write(text, caret));
editor.onCaret((caret) => store.moveCaret(caret));
// Coming back to the text means the delete was not meant: enter must type a
// newline again, not confirm.
editor.onFocus(() => store.cancelDelete());
editor.onReadScroll((fraction) => store.moveScroll(fraction));
editor.onView((mode) => {
  store.setMode(mode);
  if (mode === 'write') editor.focus();
});

// ---------- actions ----------

async function copyAll(): Promise<void> {
  try {
    await navigator.clipboard.writeText(editor.getText());
    footer.acknowledge('copy', strings.copied);
  } catch {
    // Clipboard denied: select the draft instead, so ⌘C is one key away.
    editor.selectAll();
  }
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // Revoking in the same tick can cancel the download it just started.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportDraft(): void {
  const text = editor.getText();
  const name = `${slugOf(text)}.md`;
  download(new Blob([text], { type: 'text/markdown' }), name);
  footer.acknowledge('export', strings.exported(name));
  store.flash(strings.exported(name));
}

const hasText = () => store.state.drafts.some((draft) => draft.text.trim());

interface SaveFilePicker {
  (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }): Promise<{
    createWritable(): Promise<{
      write(data: Blob): Promise<void>;
      close(): Promise<void>;
    }>;
  }>;
}

/**
 * Saves a backup through Chrome's save dialog, which — unlike a download —
 * says whether the file was written: a dialog closed without saving is not a
 * backup, and must not quiet the reminder. Where there is no such dialog, the
 * download is the only way, and it says nothing back.
 */
async function saveBackup(blob: Blob, name: string): Promise<boolean> {
  const picker = (window as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (!picker) {
    download(blob, name);
    return true;
  }
  let handle: Awaited<ReturnType<SaveFilePicker>>;
  try {
    handle = await picker.call(window, {
      suggestedName: name,
      types: [
        {
          description: strings.backupFileType,
          accept: { 'application/json': ['.json'] },
        },
      ],
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') return false;
    // Refused for some other reason (a policy, a sandbox): download instead.
    download(blob, name);
    return true;
  }
  try {
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

/** Every draft, whole, in one `.json`; see `backup.ts`. */
async function backupAll(): Promise<void> {
  if (!hasText()) {
    store.flash(strings.backupEmpty);
    return;
  }
  const name = backupName();
  const blob = new Blob([writeBackup(store.state.drafts)], { type: 'application/json' });
  if (!(await saveBackup(blob, name))) {
    store.flash(strings.backupCancelled);
    return;
  }
  store.markBackedUp();
  store.flash(strings.backedUp(name));
}

/** Every draft as a `.md`, in one `.zip`, for reading elsewhere. */
function exportAll(): void {
  if (!hasText()) {
    store.flash(strings.backupEmpty);
    return;
  }
  const name = exportName();
  const bytes = writeZip(markdownEntries(store.state.drafts));
  download(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }), name);
  store.flash(strings.exportedAll(name));
}

function pickFiles(accept: string, multiple: boolean): void {
  fileInput.accept = accept;
  fileInput.multiple = multiple;
  fileInput.click();
}

function confirmRestore(): void {
  if (!pendingRestore) return;
  const { drafts } = pendingRestore.backup;
  pendingRestore = null;
  const outcome = store.importDrafts(drafts);
  store.flash(strings.restored(outcome.added, outcome.updated));
}

function cancelRestore(): void {
  pendingRestore = null;
  paint(store.state);
}

function closeSettings(): void {
  store.setSettings(false);
  editor.focus();
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
 * A backup `.json` is read and shown in the settings, where the writer sees
 * what it would change and says yes; it is never applied on the drop alone.
 * Only the first one counts — two backups at once have no sensible order.
 */
async function openBackup(file: File): Promise<boolean> {
  try {
    const backup = readBackup(await file.text());
    pendingRestore = { backup, preview: store.previewImport(backup.drafts) };
  } catch {
    store.flash(strings.restoreFailed);
    return false;
  }
  if (store.state.settingsOpen) paint(store.state);
  else store.setSettings(true);
  // The question on screen is "restore?", so that is where the keyboard goes.
  settingsEl
    .querySelector<HTMLElement>(
      '[data-action="restore-confirm"], [data-action="restore-cancel"]',
    )
    ?.focus();
  return true;
}

/**
 * Where files come from decides what they may be. Dropped on the page, only a
 * `.md` or `.txt` is taken, each becoming a draft of its own, dated by the
 * file. A `.zip` of notes and a backup bring in many drafts at once, so they
 * come in only through the settings' own buttons — `open` and `restore` — and
 * a drop of either is turned away with a word on where to take it. Nothing
 * is taken silently: the footer says what happened.
 */
async function openFiles(
  files: File[],
  from: 'drop' | 'open' | 'restore',
): Promise<void> {
  // A drop in the first instants must not land in drafts the load then replaces.
  await booted;
  const backup = files.find((file) => isBackupFile(file.name));
  if (backup && from === 'restore') {
    await openBackup(backup);
    return;
  }
  const accepted = files.filter(
    (file) => isTextFile(file.name) || (from === 'open' && isArchive(file.name)),
  );
  if (!accepted.length) {
    const many = files.some((file) => isBackupFile(file.name) || isArchive(file.name));
    store.flash(many ? strings.dropToSettings : strings.dropOnly);
    return;
  }
  let opened = 0;
  /** Notes in a `.zip` whose text is already here, and so not opened again. */
  let already = 0;
  let failed = false;
  for (const file of accepted) {
    if (isArchive(file.name)) {
      try {
        const entries = await readZip(new Uint8Array(await file.arrayBuffer()));
        const outcome = store.importDrafts(draftsFromArchive(entries));
        opened += outcome.added + outcome.updated;
        already += outcome.same;
      } catch {
        failed = true;
      }
    } else {
      // An empty file has nothing to open.
      const text = (await file.text()).replace(/\r\n?/g, '\n');
      if (!text.trim()) continue;
      store.create(text, file.lastModified);
      opened += 1;
    }
  }
  if (opened) editor.focus();
  if (failed) store.flash(strings.zipFailed);
  else if (accepted.length < files.length) store.flash(strings.dropOnly);
  else if (opened) store.flash(strings.dropped(opened));
  else store.flash(already ? strings.droppedAlready : strings.droppedNothing);
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

/** Reading has no source to search, so there `⌘F` stays Chrome's. */
function openFind(): boolean {
  const { mode, searchOpen, settingsOpen } = store.state;
  if (mode === 'read' || searchOpen || settingsOpen) return false;
  store.setFind(true);
  find.open();
  return true;
}

function closeFind(): void {
  store.setFind(false);
  editor.focus();
}

// ---------- events ----------

const actionOf = (event: Event): string | undefined =>
  (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;

topbarEl.addEventListener('click', (event) => {
  const action = actionOf(event);
  // The view switch is on the toolbar at every width now, so the top bar only
  // opens the drafts.
  if (action === 'rail') store.setRail(!store.state.railOpen);
});

railEl.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-id],[data-action]',
  );
  if (!target) return;
  if (target.dataset.id) openDraft(target.dataset.id);
  else if (target.dataset.action === 'new') createDraft();
  else if (target.dataset.action === 'search') store.setSearch(true);
  else if (target.dataset.action === 'settings') store.setSettings(true);
  else if (target.dataset.action === 'close') store.setRail(false);
});

/**
 * Where the caret goes after a footer button. A click — `detail` counts the
 * clicks — hands it back to the text, so copying or switching the theme with
 * the mouse never leaves the next keystroke typed into a button. Enter or
 * space on a focused button leaves it there, where a keyboard user is
 * tabbing. Delete is the exception on its first press: focus stays put, so
 * enter can confirm — the editor taking focus would cancel it.
 */
footerEl.addEventListener('click', (event) => {
  const action = actionOf(event);
  if (action === 'copy') void copyAll();
  else if (action === 'export') exportDraft();
  else if (action === 'delete') deleteDraft();
  else if (action === 'undo') undoDelete();
  else if (action === 'theme') toggleTheme();
  if (event.detail > 0 && action !== 'delete') editor.focus();
});

// Leaving the delete button for another control is leaving the question
// unanswered: the button stops waiting for its second press. Focus going
// nowhere (`relatedTarget` null, a click on bare page) keeps it waiting.
const deleteButton = footerEl.querySelector<HTMLElement>('[data-action="delete"]')!;
deleteButton.addEventListener('focusout', (event) => {
  if (event.relatedTarget) store.cancelDelete();
});

searchEl.addEventListener('input', (event) => {
  const input = event.target as HTMLInputElement;
  if (input.classList.contains('search__input')) store.setQuery(input.value);
});

searchEl.addEventListener('click', (event) => {
  const id = (event.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id;
  const action = actionOf(event);
  if (id) openDraft(id);
  else if (action === 'close') closeSearch();
});

settingsEl.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  const action = target?.dataset.action;
  if (action === 'close') closeSettings();
  else if (action === 'backup') void backupAll();
  else if (action === 'restore') pickFiles('.json,application/json', false);
  else if (action === 'restore-confirm') confirmRestore();
  else if (action === 'restore-cancel') cancelRestore();
  else if (action === 'export-all') exportAll();
  else if (action === 'open-files') pickFiles('.md,.markdown,.txt,.zip', true);
  else if (action === 'theme') {
    const choice = target?.dataset.themeChoice;
    if (choice === 'system' || choice === 'light' || choice === 'dark')
      store.setTheme(choice);
  }
});

fileInput.addEventListener('change', () => {
  const files = [...(fileInput.files ?? [])];
  // Cleared, so choosing the same file again still fires `change`.
  fileInput.value = '';
  // The restore button is the one that asks for `.json`.
  if (files.length)
    void openFiles(files, fileInput.accept.includes('.json') ? 'restore' : 'open');
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
 * shortcut means checking both keymaps first; `⌘S`, `⌘F` and `⌘G` survive
 * only because the `save`, `find` and `findNext` commands CodeMirror binds
 * them to are never defined — loading its search addon would take them away.
 */
window.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  const state = store.state;
  const key = shortcutKey(event);

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
    } else if (event.code === 'Comma' && event.shiftKey) {
      // By its key, not its character: shift turns the comma into `<` on
      // most layouts. Plain ⌘, is Chrome's own settings on a Mac.
      event.preventDefault();
      if (state.settingsOpen) closeSettings();
      else store.setSettings(true);
    } else if (key === 'f' && !event.shiftKey) {
      if (openFind()) event.preventDefault();
    } else if (key === 'g' && state.findOpen && !state.searchOpen) {
      event.preventDefault();
      find.next(event.shiftKey ? -1 : 1);
    }
    return;
  }

  if (state.settingsOpen) {
    if (event.key === 'Escape') {
      event.preventDefault();
      // A restore waiting for an answer is the first thing escape says no to.
      if (pendingRestore) cancelRestore();
      else closeSettings();
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
      // Enter confirms only from the delete button itself, or with focus
      // nowhere in particular. On any other control it means that control:
      // tabbing from delete to "copy" and pressing enter must copy, not
      // delete the draft.
      const focused = document.activeElement;
      if (focused !== deleteButton && focused !== document.body) {
        store.cancelDelete();
        return;
      }
      event.preventDefault();
      deleteDraft();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      // Escape means "not this": back to the text, wherever focus was.
      store.cancelDelete();
      editor.focus();
    }
    return;
  }

  if (state.deleted && event.key === 'Escape') {
    event.preventDefault();
    undoDelete();
    return;
  }

  if (state.findOpen && event.key === 'Escape') {
    event.preventDefault();
    closeFind();
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
    void openFiles([...(event.dataTransfer?.files ?? [])], 'drop');
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
