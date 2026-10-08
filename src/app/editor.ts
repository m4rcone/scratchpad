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
import { strings } from './strings.ts';

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
  /** Re-measure after the host goes from hidden to visible. */
  refresh(): void;
  setMode(mode: Mode): void;
  setTheme(theme: 'dark' | 'light'): void;
  onInput(handler: (text: string, caret: number) => void): void;
  onCaret(handler: (caret: number) => void): void;
  onFocus(handler: () => void): void;
  /** The view buttons on ByteMD's toolbar, which the app's mode answers to. */
  onToggleView(handler: (mode: Exclude<Mode, 'write'>) => void): void;
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
 */
const EDITOR_MODE = {
  name: 'yaml-frontmatter',
  // Typed as a mode name, but `getMode` resolves a whole spec here as well.
  base: {
    name: 'gfm',
    highlightFormatting: true,
    tokenTypeOverrides: { list1: 'list', list2: 'list', list3: 'list', emoji: 'emoji' },
  } as unknown as string,
};

/**
 * The toolbar's own icons, drawn on ByteMD's 48-unit grid with its 4-unit
 * stroke so they sit among the built-in ones: two panes side by side for the
 * split view, an eye for reading, a cup for Ko-fi.
 */
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 48 48" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const SPLIT_ICON = svg(
  '<rect width="36" height="36" x="6" y="6" rx="2"/><path d="M24 6v36"/>',
);
const READ_ICON = svg(
  '<path d="M4 24s7-13 20-13 20 13 20 13-7 13-20 13S4 24 4 24Z"/><circle cx="24" cy="24" r="6"/>',
);
const SUPPORT_ICON = svg(
  '<path d="M8 18h26v12a10 10 0 0 1-10 10h-6A10 10 0 0 1 8 30V18Z"/><path d="M34 21h3a5 5 0 0 1 0 10h-3"/><path d="M16 6v6M24 6v6"/>',
);

/**
 * The only address the app knows. It opens in a tab of its own when the
 * writer clicks the cup; nothing is ever fetched from it.
 */
const SUPPORT_URL = 'https://ko-fi.com/m4rcone';

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
  const viewHandlers: ((mode: Exclude<Mode, 'write'>) => void)[] = [];
  const toggleView = (mode: Exclude<Mode, 'write'>) =>
    viewHandlers.forEach((handler) => handler(mode));
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
  /** The palette the current plugin list was built with; `setMode` reuses it. */
  let painted = theme;
  /**
   * True while `setText` is loading a draft. CodeMirror reports a `setValue`
   * as a change like any other, and reporting that back as input would save
   * the draft we just opened over itself and move it to the top of the rail.
   * It covers the caret and focus reports for the same reason.
   */
  let loading = false;

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
   * they land after ByteMD's six built-ins, at indexes 6, 7 and 8, which is
   * how `bytemd.css` finds them.
   */
  const bridge: BytemdPlugin = {
    actions: [
      {
        position: 'right' as const,
        title: strings.splitToggle,
        icon: SPLIT_ICON,
        handler: { type: 'action' as const, click: () => toggleView('split') },
      },
      {
        position: 'right' as const,
        title: strings.readToggle,
        icon: READ_ICON,
        handler: { type: 'action' as const, click: () => toggleView('read') },
      },
      {
        position: 'right' as const,
        title: strings.support,
        icon: SUPPORT_ICON,
        handler: {
          type: 'action' as const,
          click: () => window.open(SUPPORT_URL, '_blank', 'noopener,noreferrer'),
        },
      },
    ].reverse(),
    viewerEffect({ markdownBody }) {
      addCopyButtons(markdownBody);
    },
    editorEffect({ editor }) {
      if (cm === editor) return;
      cm = editor;
      // `setValue` drops the cursor at 0,0 and fires `cursorActivity` before
      // `placeCaret` puts it back, so an unguarded handler persisted caret 0
      // over the draft's own and scheduled a save for a draft nobody edited —
      // which is what discarded the pending write of the draft being left.
      editor.on('cursorActivity', () => {
        if (loading) return;
        for (const handler of caretHandlers) handler(caretNow());
      });
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
    },
  };

  const withBridge = (choice: 'dark' | 'light') => [...markdownPlugins(choice), bridge];

  host.dataset.mode = mode;

  const component = new ByteMD({
    target: host,
    props: {
      value: '',
      mode: BYTEMD_MODE,
      plugins: withBridge(theme),
      placeholder: strings.emptyHint,
      editorConfig: {
        mode: EDITOR_MODE,
        // Two spaces, never a tab: the same indent the exported `.md` carries.
        tabSize: 2,
        indentUnit: 2,
        indentWithTabs: false,
      },
    },
  });

  component.$on('change', (event: CustomEvent<{ value: string }>) => {
    text = event.detail.value;
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
      if (cm && cm.getValue() !== next) cm.setValue(next);
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
    // CodeMirror measures the DOM to lay lines out, and measuring something
    // with `display: none` yields nothing — so text set while the editor was
    // hidden is in the document but not on screen until it is told to look
    // again. Focusing happened to trigger that, which is why the stale text
    // used to correct itself the moment the writer clicked into it.
    refresh: () => cm?.refresh(),
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
    onToggleView: (handler) => viewHandlers.push(handler),
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
