/**
 * The editor is ByteMD's, mounted here and wrapped so the rest of the app keeps
 * talking to one small interface instead of to a Svelte component.
 *
 * Two things need the CodeMirror instance that ByteMD drives internally: the
 * caret offset we persist per draft, and focus. ByteMD hands that instance to
 * every plugin through `editorEffect`, so the bridge below is a plugin whose
 * only job is to catch it. That capture happens a microtask after mount, which
 * is why a caret or a focus asked for before it lands is parked and replayed.
 */
import { Editor as ByteMDComponent } from 'bytemd';
import type { BytemdPlugin, EditorProps } from 'bytemd';
import type { Editor as CodeMirrorEditor } from 'codemirror';
import { markdownPlugins } from './plugins.ts';
import type { Mode } from './store.ts';
import { findAll } from './find.ts';
import { editorUtils } from './format.ts';
import { frontMatterLines } from './syntax.ts';
import { formatChord } from './platform.ts';
import { strings } from './strings.ts';
import { keyboardToolbar } from './toolbar.ts';
import { collapseRepeatedMarker, outdentEmptyItem } from './lists.ts';
import { toggleTask } from './tasks.ts';

/**
 * ByteMD's own typings extend `SvelteComponentTyped`, which needs the `svelte`
 * package to resolve. Its runtime is already baked into `bytemd/dist`, so
 * installing the compiler for types alone would buy nothing; the two members
 * this file actually touches are named here instead.
 */
interface ByteMDInstance {
  $set(props: Partial<EditorProps>): void;
  $on(event: 'change', handler: (event: CustomEvent<{ value: string }>) => void): void;
}

const ByteMD = ByteMDComponent as unknown as new (options: {
  target: HTMLElement;
  props: EditorProps;
}) => ByteMDInstance;

/**
 * ByteMD is pinned to `split` and never told otherwise. Its `tab` mode is the
 * only thing that renders the Write/Preview tabs, and in that mode the toolbar
 * shows the tabs *instead of* the formatting actions — so switching modes
 * swapped the whole top bar out. Staying in `split` keeps one fixed toolbar,
 * and the app's own `write` view is the same layout with the preview pane
 * folded away in CSS (see `bytemd.css`), which is what `data-mode` selects.
 */
const BYTEMD_MODE = 'split';

export interface Editor {
  setText(text: string, caret?: number): void;
  getText(): string;
  focus(): void;
  /** Selects the whole draft, for when the clipboard refuses a copy. */
  selectAll(): void;
  /** The selection as offsets into the text; equal when it is a bare caret. */
  selection(): { from: number; to: number };
  /** Selects a range and scrolls it into view, without taking focus. */
  select(from: number, to: number): void;
  /**
   * Tints every occurrence of `query` in the source, `null` to clear. The tint
   * is a CodeMirror overlay, so it costs only the lines on screen.
   */
  highlight(query: string | null, caseSensitive: boolean): void;
  /** Marks the one occurrence find is on, `null` to clear. */
  markCurrent(range: { from: number; to: number } | null): void;
  /** Replaces each range with `text`, as one step for undo. */
  replace(ranges: { from: number; to: number }[], text: string): void;
  /** Re-measure after the host goes from hidden to visible. */
  refresh(): void;
  /**
   * How far from the pane's top and bottom edges the caret is kept: the
   * toolbar and the footer float over the text, so a caret scrolled to the
   * very edge would sit under one of them.
   */
  setCaretMargin(px: number): void;
  setMode(mode: Mode): void;
  setTheme(theme: 'dark' | 'light'): void;
  /**
   * Numbers in the source's margin. They take the room the margin already
   * has, so turning them on does not move the text (`bytemd.css`).
   */
  setLineNumbers(on: boolean): void;
  /** Where the caret is, counted from 1 the way an editor's status bar does. */
  position(): { line: number; column: number } | null;
  onInput(handler: (text: string, caret: number) => void): void;
  onCaret(handler: (caret: number) => void): void;
  onFocus(handler: () => void): void;
  /** The view switch on ByteMD's toolbar: a click asks for that view. */
  onView(handler: (mode: Mode) => void): void;
  /** The focus button on ByteMD's toolbar. */
  onFocusMode(handler: () => void): void;
  /** Scrolls the reading view to a fraction of its height; see `Draft.scroll`. */
  setReadScroll(fraction: number): void;
  /** The writer scrolling the reading view, as a fraction of its height. */
  onReadScroll(handler: (fraction: number) => void): void;
}

/**
 * CodeMirror's markdown mode, told to tag what it already recognises. With
 * `highlightFormatting` every marker — `#`, `**`, `>`, `-`, the backticks — gets
 * a `cm-formatting` class, which is what lets the stylesheet mute the marks and
 * leave the words alone. The overrides rename the classes the mode borrows from
 * programming languages: list levels would otherwise arrive as `variable-2`,
 * `variable-3` and `keyword`, and emoji as `builtin`.
 *
 * `gitHubSpice` is off because it styles any run of 7 to 40 hex digits as a
 * commit hash and `#123` as an issue — a phone number looked like a link — and
 * the preview links neither.
 */
const MARKDOWN_MODE = {
  name: 'gfm',
  highlightFormatting: true,
  gitHubSpice: false,
  tokenTypeOverrides: { list1: 'list', list2: 'list', list3: 'list', emoji: 'emoji' },
};

/**
 * The same, under a front matter coloured as YAML. CodeMirror's mode reads
 * lines in order and cannot look ahead: it takes a first `---` as the start of
 * one and colours everything as YAML until a closing line — the whole draft,
 * when that `---` was a rule. So it is switched on only while the draft has a
 * closed front matter, by the rule the preview hides it by (`model.ts`).
 */
const FRONT_MATTER_MODE = {
  name: 'yaml-frontmatter',
  // Typed as a mode name, but `getMode` resolves a whole spec here as well.
  base: MARKDOWN_MODE as unknown as string,
};

/**
 * Icons drawn on ByteMD's 48-unit grid with its 4-unit stroke, so they sit
 * among the built-in ones. The three views are words, not icons: they are the
 * app's main switch, and `bytemd.css` draws them as one segmented control.
 */
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 48 48" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
/** Four corners, where ByteMD's fullscreen button was: the text alone. */
const FOCUS_ICON = svg('<path d="M6 17V6h11M31 6h11v11M42 31v11H31M17 42H6V31"/>');
/** The `?` sheet's icons for the app's own shortcuts, on ByteMD's grid. */
const HELP_ICONS: Record<string, string> = {
  new: svg('<path d="M28 6H12v36h24V14l-8-8Z"/><path d="M28 6v8h8M24 22v12M18 28h12"/>'),
  search: svg('<circle cx="21" cy="21" r="13"/><path d="M31 31l11 11"/>'),
  find: svg(
    '<path d="M6 12h24M6 24h12M6 36h12"/><circle cx="32" cy="30" r="7"/><path d="M37 35l6 6"/>',
  ),
  split: svg('<rect width="36" height="32" x="6" y="8" rx="2"/><path d="M24 8v32"/>'),
  read: svg(
    '<path d="M4 24s7-13 20-13 20 13 20 13-7 13-20 13S4 24 4 24Z"/><circle cx="24" cy="24" r="6"/>',
  ),
  copy: svg(
    '<rect width="26" height="26" x="16" y="16" rx="2"/><path d="M32 16V8a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v22a2 2 0 0 0 2 2h8"/>',
  ),
  export: svg('<path d="M24 6v24M14 20l10 10 10-10M8 34v8h32v-8"/>'),
  settings: svg(
    '<path d="M6 14h22M36 14h6M6 34h6M20 34h22"/><circle cx="32" cy="14" r="4"/><circle cx="16" cy="34" r="4"/>',
  ),
  open: svg(
    '<rect width="40" height="26" x="4" y="11" rx="3"/><path d="M12 19h2M20 19h2M28 19h2M35 19h1M14 29h20"/>',
  ),
  focus: FOCUS_ICON,
};
/**
 * Whether CodeMirror's markdown mode read this line as a list item: its marker
 * is tagged `formatting-list`. A dash in a code block is not, so the list
 * corrections below never touch code.
 */
function isListLine(cm: CodeMirrorEditor, line: number): boolean {
  const text = cm.getLine(line);
  const marker = text.search(/[-*+]|\d/);
  if (marker < 0) return false;
  return /formatting-list/.test(cm.getTokenTypeAt({ line, ch: marker + 1 }) ?? '');
}

/**
 * Enter, as ByteMD binds it, with one change: on an empty item of a nested
 * list it steps out one level instead of ending the whole list (`lists.ts`).
 */
function continueList(cm: CodeMirrorEditor): void {
  const ranges = cm.listSelections();
  const caret = cm.getCursor();
  const text = cm.getLine(caret.line);
  if (
    ranges.length === 1 &&
    !cm.somethingSelected() &&
    caret.ch === text.length &&
    isListLine(cm, caret.line)
  ) {
    const from = Math.max(0, caret.line - 200);
    const lines = cm.getRange({ line: from, ch: 0 }, caret).split('\n');
    const next = outdentEmptyItem(lines, lines.length - 1);
    if (next !== null) {
      cm.replaceRange(next, { line: caret.line, ch: 0 }, caret, '+input');
      return;
    }
  }
  cm.execCommand('newlineAndIndentContinueMarkdownList');
}

/**
 * The marker typed again right after enter wrote it — `- - ` — folded back
 * into one as the space that completes it is typed (`lists.ts`).
 */
function foldRepeatedMarker(cm: CodeMirrorEditor, change: { text: string[] }): void {
  if (change.text.join('\n') !== ' ' || cm.listSelections().length !== 1) return;
  const caret = cm.getCursor();
  const line = cm.getLine(caret.line);
  if (caret.ch !== line.length) return;
  const folded = collapseRepeatedMarker(line);
  if (folded === null || !isListLine(cm, caret.line)) return;
  cm.replaceRange(folded, { line: caret.line, ch: 0 }, caret, '+input');
}

const viewLabel = (label: string) => `<span class="view-label">${label}</span>`;
const VIEWS: Mode[] = ['write', 'split', 'read'];
/** Where ByteMD puts the bridge's buttons; see `bytemd.css`. Focus is at 9. */
const VIEW_PATH: Record<Mode, string> = { write: '6', split: '7', read: '8' };

/**
 * The app's own shortcuts, as the first section of ByteMD's `?` sheet, which
 * otherwise lists only its formatting keys. ByteMD has no hook for the sheet,
 * so the section is added to its markup and added again if ByteMD redraws it.
 */
function addAppShortcuts(host: HTMLElement): void {
  const help = host.querySelector<HTMLElement>('.bytemd-help');
  if (!help) return;
  // ByteMD's own keys, in the app's notation. Marked once done, since ByteMD
  // rewrites them only when its plugins change, and then they are new nodes.
  for (const key of help.querySelectorAll<HTMLElement>('kbd:not([data-chord])')) {
    key.dataset.chord = key.textContent ?? '';
    key.textContent = formatChord(key.dataset.chord);
  }
  if (help.querySelector('.app-shortcuts')) return;
  const section = document.createElement('div');
  section.className = 'app-shortcuts';
  const title = document.createElement('h2');
  title.textContent = strings.shortcutsTitle;
  const list = document.createElement('ul');
  for (const { icon: drawing, label, keys } of strings.shortcuts) {
    const item = document.createElement('li');
    // An icon like ByteMD's own rows have, so the titles share their column.
    const icon = document.createElement('div');
    icon.className = 'bytemd-help-icon';
    icon.innerHTML = HELP_ICONS[drawing] ?? '';
    const name = document.createElement('div');
    name.className = 'bytemd-help-title';
    name.textContent = label;
    const content = document.createElement('div');
    content.className = 'bytemd-help-content';
    const key = document.createElement('kbd');
    key.textContent = keys;
    content.append(key);
    item.append(icon, name, content);
    list.append(item);
  }
  section.append(title, list);
  help.prepend(section);
}

/**
 * Gives every code block in the preview a copy button. The block is wrapped
 * rather than the button put inside the `pre`, which scrolls sideways and
 * would carry the button away with a long line. The wrapper takes the `pre`'s
 * place one for one, so ByteMD's split-view scroll sync, which pairs the
 * preview's top-level elements with the markdown's, still counts the same.
 *
 * ByteMD calls this after every update, and an update does not always rewrite
 * the HTML, so a block already wrapped is left alone. Mermaid's blocks are
 * skipped: its own effect is about to replace them with a diagram.
 */
function addCopyButtons(body: HTMLElement): void {
  for (const pre of body.querySelectorAll<HTMLElement>('pre')) {
    if (pre.parentElement?.classList.contains('code-block')) continue;
    if (pre.querySelector('code.language-mermaid')) continue;
    const block = document.createElement('div');
    block.className = 'code-block';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.textContent = strings.copyCode;
    // Every block's button reads "copy"; a screen reader needs to know what.
    button.setAttribute('aria-label', strings.copyCodeLabel);
    pre.replaceWith(block);
    block.append(pre, button);
  }
}

export function createEditor(
  host: HTMLElement,
  mode: Mode,
  theme: 'dark' | 'light',
): Editor {
  const inputHandlers: ((text: string, caret: number) => void)[] = [];
  const caretHandlers: ((caret: number) => void)[] = [];
  const focusHandlers: (() => void)[] = [];
  const viewHandlers: ((mode: Mode) => void)[] = [];
  const askView = (mode: Mode) => viewHandlers.forEach((handler) => handler(mode));
  const focusModeHandlers: (() => void)[] = [];
  const scrollHandlers: ((fraction: number) => void)[] = [];
  /**
   * True from the moment a reading position is asked for until it has been
   * applied. Entering the view re-renders the preview, and the scroll events
   * that churn sets off would otherwise be saved over the position being
   * restored.
   */
  let restoring = false;

  let cm: CodeMirrorEditor | null = null;
  let text = '';
  let pendingCaret: number | null = null;
  let pendingFocus = false;
  let caretMargin = 0;
  /** The palette the current plugin list was built with; `setMode` reuses it. */
  let painted = theme;
  /**
   * True while `setText` is loading a draft. CodeMirror reports a `setValue`
   * as a change like any other, and reporting that back as input would save
   * the draft we just opened over itself and move it to the top of the rail.
   * It covers the caret and focus reports for the same reason.
   */
  let loading = false;
  let overlay: object | null = null;
  let current: { clear(): void } | null = null;
  let lineNumbers = false;
  /** The line the caret is on, whose number is drawn in full ink. */
  let caretLine: object | null = null;

  /** Whether the editor is in `FRONT_MATTER_MODE`. */
  let frontMatter = false;

  /** Front matter coloured as YAML while the draft has one, and only then. */
  function matchFrontMatter(): void {
    const on = frontMatterLines(text) > 0;
    if (!cm || on === frontMatter) return;
    frontMatter = on;
    cm.setOption('mode', on ? FRONT_MATTER_MODE : MARKDOWN_MODE);
  }

  function markCaretLine(): void {
    if (!cm) return;
    const line = lineNumbers ? cm.getLineHandle(cm.getCursor().line) : null;
    if (line === caretLine) return;
    // A handle from a draft since replaced is no longer in the document, and
    // CodeMirror leaves it alone.
    if (caretLine) cm.removeLineClass(caretLine as never, 'gutter', 'is-current');
    if (line) cm.addLineClass(line, 'gutter', 'is-current');
    caretLine = line;
  }

  const clamp = (caret: number) => Math.min(Math.max(caret, 0), text.length);
  const caretNow = () => (cm ? cm.indexFromPos(cm.getCursor()) : clamp(text.length));

  function placeCaret(caret: number): void {
    if (!cm) {
      pendingCaret = caret;
      return;
    }
    cm.setCursor(cm.posFromIndex(clamp(caret)));
  }

  /**
   * Not a markdown plugin: the hook ByteMD offers is the only way in. It also
   * carries the toolbar buttons the app adds, since a plugin's `right` actions
   * are the only thing ByteMD lets in beside its own. ByteMD `unshift`s each
   * one, so the list is written in display order and reversed on the way in;
   * they land after ByteMD's six built-ins — write, split and read at indexes
   * 6, 7 and 8, focus at 9 — which is how `bytemd.css` finds them.
   */
  const viewTitles: Record<Mode, string> = {
    write: strings.viewWriteTitle,
    split: strings.viewSplitTitle,
    read: strings.viewReadTitle,
  };
  const viewNames: Record<Mode, string> = {
    write: strings.viewWrite,
    split: strings.viewSplit,
    read: strings.viewRead,
  };
  const bridge: BytemdPlugin = {
    actions: [
      ...VIEWS.map((view) => ({
        position: 'right' as const,
        title: viewTitles[view],
        icon: viewLabel(viewNames[view]),
        handler: { type: 'action' as const, click: () => askView(view) },
      })),
      {
        position: 'right' as const,
        title: strings.focusTitle,
        icon: FOCUS_ICON,
        handler: {
          type: 'action' as const,
          click: () => focusModeHandlers.forEach((handler) => handler()),
        },
      },
    ].reverse(),
    viewerEffect({ markdownBody }) {
      addCopyButtons(markdownBody);
    },
    editorEffect(context) {
      const { editor } = context;
      // The context is one object, shared by the toolbar, the shortcuts and
      // every plugin: the formatting helpers on it are swapped for ours
      // (`format.ts`), and every action reads them from it when it runs.
      // Again on every call, in case ByteMD built a new one.
      Object.assign(context, editorUtils(context.codemirror, editor));
      // Every plugin change redraws the toolbar and may redraw the sheet.
      markViews();
      toolbar?.refresh();
      addAppShortcuts(host);
      if (cm === editor) return;
      cm = editor;
      frontMatter = false;
      matchFrontMatter();
      // `setValue` drops the cursor at 0,0 and fires `cursorActivity` before
      // `placeCaret` puts it back, so an unguarded handler persisted caret 0
      // over the draft's own and scheduled a save for a draft nobody edited —
      // which is what discarded the pending write of the draft being left.
      editor.on('cursorActivity', () => {
        markCaretLine();
        if (loading) return;
        for (const handler of caretHandlers) handler(caretNow());
      });
      editor.on('inputRead', foldRepeatedMarker);
      editor.on('focus', () => {
        if (loading) return;
        for (const handler of focusHandlers) handler();
      });
      if (pendingCaret !== null) {
        placeCaret(pendingCaret);
        pendingCaret = null;
      }
      if (pendingFocus) {
        pendingFocus = false;
        editor.focus();
      }
      if (caretMargin) editor.setOption('cursorScrollMargin', caretMargin);
      if (lineNumbers) {
        editor.setOption('lineNumbers', true);
        markCaretLine();
        // Turned on before the editor is laid out, the numbers' column
        // measures nothing: they were drawn over the text, and wrapped lines
        // put them out of step. Measured again once there is a layout.
        requestAnimationFrame(() => editor.refresh());
      }
    },
  };

  /**
   * The segment that is on, for assistive tech; the look comes from
   * `data-mode` in CSS. The button role and focus come from `toolbar.ts`.
   */
  function markViews(): void {
    for (const view of VIEWS) {
      const item = host.querySelector<HTMLElement>(
        `.bytemd-toolbar-right > [bytemd-tippy-path='${VIEW_PATH[view]}']`,
      );
      if (!item) continue;
      item.setAttribute('aria-pressed', String(host.dataset.mode === view));
    }
  }

  // The sheet is drawn when the `?` button first opens it.
  host.addEventListener('click', (event) => {
    if (
      (event.target as HTMLElement).closest(
        ".bytemd-toolbar-right > [bytemd-tippy-path='1']",
      )
    )
      requestAnimationFrame(() => addAppShortcuts(host));
  });

  const withBridge = (choice: 'dark' | 'light') => [...markdownPlugins(choice), bridge];
  /** Set right after mount; ByteMD's first effect runs before it is. */
  let toolbar: { refresh(): void } | null = null;

  host.dataset.mode = mode;

  const component = new ByteMD({
    target: host,
    props: {
      value: '',
      mode: BYTEMD_MODE,
      plugins: withBridge(theme),
      placeholder: strings.emptyHint,
      editorConfig: {
        mode: MARKDOWN_MODE,
        // Two spaces, never a tab: the same indent the exported `.md` carries.
        tabSize: 2,
        indentUnit: 2,
        indentWithTabs: false,
        // Replaces ByteMD's own binding, the only extra key it sets.
        extraKeys: { Enter: continueList },
      },
    },
  });

  toolbar = keyboardToolbar(host, strings.toolbarLabel, () => cm?.focus());
  toolbar.refresh();

  component.$on('change', (event: CustomEvent<{ value: string }>) => {
    text = event.detail.value;
    matchFrontMatter();
    // ByteMD is a controlled component: keeping the prop equal to what was
    // typed stops the next unrelated `$set` from resurrecting a stale value.
    component.$set({ value: text });
    if (loading) return;
    for (const handler of inputHandlers) handler(text, caretNow());
  });

  /**
   * A link in the preview must not take the scratchpad's own tab somewhere
   * else. Outside links get a new tab — set on the anchor rather than opened by
   * hand, so ⌘-click and middle-click keep meaning what they always do.
   * In-page links (footnotes, and their way back) scroll the preview instead of
   * writing a fragment into the page URL.
   */
  host.addEventListener('click', (event) => {
    const copy = (event.target as HTMLElement).closest<HTMLElement>('.code-copy');
    if (copy) {
      const code = copy.parentElement?.querySelector('pre')?.textContent ?? '';
      void navigator.clipboard.writeText(code).then(
        () => {
          copy.textContent = strings.codeCopied;
          setTimeout(() => (copy.textContent = strings.copyCode), 1500);
        },
        () => {
          /* clipboard denied: the code is still there to select by hand */
        },
      );
      return;
    }
    // A task box ticked in the preview is ticked in the text; the preview is
    // redrawn from there. The click itself changes nothing, so a box whose
    // item has moved on stays as the text has it.
    const box = (event.target as HTMLElement).closest<HTMLInputElement>(
      '.bytemd-preview input[data-task-at]',
    );
    if (box) {
      event.preventDefault();
      const edit = cm && toggleTask(cm.getValue(), Number(box.dataset.taskAt));
      if (cm && edit) {
        cm.replaceRange(
          edit.text,
          cm.posFromIndex(edit.from),
          cm.posFromIndex(edit.to),
          '+task',
        );
      }
      return;
    }
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>(
      '.bytemd-preview a[href]',
    );
    if (!anchor) return;
    const href = anchor.getAttribute('href') ?? '';
    if (!href.startsWith('#')) {
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      return;
    }
    event.preventDefault();
    let id = href.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      /* a stray `%` in a hand-written link: look the fragment up as typed */
    }
    // The sanitizer prefixes every id with `user-content-`; a hand-written
    // `#heading` link names the unprefixed one, which may not exist at all.
    const preview = anchor.closest('.bytemd-preview');
    const target =
      preview?.querySelector(`[id="${CSS.escape(id)}"]`) ??
      preview?.querySelector(`[id="user-content-${CSS.escape(id)}"]`);
    target?.scrollIntoView({ block: 'start' });
  });

  // The numbers' column is the margin's width, which narrows at 1100px.
  // CodeMirror sizes the text beside it only when it measures, so it is asked
  // to measure again when the margin changes.
  window.matchMedia('(max-width: 1100px)').addEventListener('change', () => {
    if (lineNumbers) cm?.refresh();
  });

  const preview = () => host.querySelector<HTMLElement>('.bytemd-preview');
  const scrollable = (pane: HTMLElement) => pane.scrollHeight - pane.clientHeight;

  // `scroll` does not bubble, so the pane is listened to through the capture
  // phase: ByteMD may rebuild it, and the host is the one element that stays.
  host.addEventListener(
    'scroll',
    (event) => {
      const pane = event.target as HTMLElement;
      if (restoring || host.dataset.mode !== 'read') return;
      if (!pane.classList?.contains('bytemd-preview')) return;
      const range = scrollable(pane);
      const fraction = range > 0 ? Math.round((pane.scrollTop / range) * 1e4) / 1e4 : 0;
      for (const handler of scrollHandlers) handler(fraction);
    },
    { capture: true },
  );

  return {
    setText(next, caret) {
      loading = true;
      text = next;
      // CodeMirror first and synchronously, so the caret below lands on the
      // text it was measured against; the prop then follows to stay in sync.
      // That `setValue` echoes back through `change` in this same task, which
      // is what `loading` is there to swallow; the microtask covers the other
      // path, where the value reaches CodeMirror through Svelte's own flush.
      // `setValue` is an edit like any other to CodeMirror's history, so
      // without the clear an undo right after switching drafts would bring
      // the previous draft's text back into this one — and save it there.
      if (cm && cm.getValue() !== next) {
        cm.setValue(next);
        cm.clearHistory();
      }
      component.$set({ value: next });
      if (caret !== undefined) placeCaret(caret);
      queueMicrotask(() => {
        loading = false;
      });
    },
    getText: () => (cm ? cm.getValue() : text),
    focus() {
      if (cm) cm.focus();
      else pendingFocus = true;
    },
    selectAll() {
      if (!cm) return;
      cm.focus();
      cm.execCommand('selectAll');
    },
    selection() {
      if (!cm) return { from: clamp(text.length), to: clamp(text.length) };
      const a = cm.indexFromPos(cm.getCursor('from'));
      const b = cm.indexFromPos(cm.getCursor('to'));
      return { from: a, to: b };
    },
    select(from, to) {
      if (!cm) return;
      const range = { from: cm.posFromIndex(from), to: cm.posFromIndex(to) };
      cm.setSelection(range.from, range.to, { scroll: false });
      // Room enough that a match near the top is not under the find panel.
      cm.scrollIntoView(range, 120);
    },
    highlight(query, caseSensitive) {
      if (!cm) return;
      if (overlay) cm.removeOverlay(overlay);
      overlay = null;
      if (!query) return;
      // Matched the way the bar counts, so what is tinted is what is counted.
      overlay = {
        token(stream: { string: string; pos: number; skipToEnd(): void }) {
          const [match] = findAll(
            stream.string.slice(stream.pos),
            query,
            caseSensitive,
            1,
          );
          if (!match) stream.skipToEnd();
          else if (match.from === 0) {
            stream.pos += match.to;
            return 'searching';
          } else stream.pos += match.from;
          return null;
        },
      };
      cm.addOverlay(overlay);
    },
    markCurrent(range) {
      current?.clear();
      current = null;
      if (!cm || !range) return;
      current = cm.markText(cm.posFromIndex(range.from), cm.posFromIndex(range.to), {
        className: 'find-current',
      });
    },
    replace(ranges, replacement) {
      const editor = cm;
      if (!editor || !ranges.length) return;
      // Back to front, so each offset still points where it did. One
      // operation is one entry in the history: a single undo takes it back.
      editor.operation(() => {
        for (const range of [...ranges].reverse()) {
          editor.replaceRange(
            replacement,
            editor.posFromIndex(range.from),
            editor.posFromIndex(range.to),
            '+replace',
          );
        }
      });
    },
    // CodeMirror measures the DOM to lay lines out, and measuring something
    // with `display: none` yields nothing — so text set while the editor was
    // hidden is in the document but not on screen until it is told to look
    // again. Focusing happened to trigger that, which is why the stale text
    // used to correct itself the moment the writer clicked into it.
    refresh: () => cm?.refresh(),
    setCaretMargin(px) {
      caretMargin = px;
      cm?.setOption('cursorScrollMargin', px);
    },
    // Folding either pane away is CSS, but unfolding it is not.
    //
    // The preview: mermaid lays diagrams out with `getBBox`, and a
    // `display: none` preview measures zero. A flowchart drawn while folded
    // comes back as a 16x16 box with `translate(undefined, NaN)` on its edge
    // labels, and revealing it does not repair the SVG that was already
    // written — only a fresh render does. So unfolding the preview re-renders
    // the viewer, now that it has a size, with the same lever `setTheme` pulls.
    //
    // The editor: CodeMirror measured nothing while reading hid it, so it is
    // asked to measure again the moment it is back.
    setMode(next) {
      const was = host.dataset.mode;
      host.dataset.mode = next;
      markViews();
      // Reading hides the formatting buttons; the tab stop moves off them.
      toolbar?.refresh();
      if (was === 'write' && next !== 'write')
        component.$set({ plugins: withBridge(painted) });
      if (was === 'read' && next !== 'read') cm?.refresh();
    },
    // Mermaid draws its colours into the SVG, so a theme change is a new plugin
    // list rather than a stylesheet swap.
    setTheme(next) {
      painted = next;
      component.$set({ plugins: withBridge(next) });
    },
    onInput: (handler) => inputHandlers.push(handler),
    onCaret: (handler) => caretHandlers.push(handler),
    onFocus: (handler) => focusHandlers.push(handler),
    onView: (handler) => viewHandlers.push(handler),
    onFocusMode: (handler) => focusModeHandlers.push(handler),
    setLineNumbers(on) {
      if (on === lineNumbers) return;
      lineNumbers = on;
      host.toggleAttribute('data-line-numbers', on);
      if (!cm) return;
      cm.setOption('lineNumbers', on);
      markCaretLine();
    },
    position() {
      if (!cm) return null;
      const { line, ch } = cm.getCursor();
      return { line: line + 1, column: ch + 1 };
    },
    // Two frames: the first lets the re-render `setMode` asked for land and
    // be laid out, the second lets the scroll it causes be swallowed.
    setReadScroll(fraction) {
      restoring = true;
      requestAnimationFrame(() => {
        const pane = preview();
        if (pane) pane.scrollTop = fraction * scrollable(pane);
        requestAnimationFrame(() => (restoring = false));
      });
    },
    onReadScroll: (handler) => scrollHandlers.push(handler),
  };
}
