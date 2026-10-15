/**
 * Status on the left, the actions on the right. The buttons are built once;
 * every paint only touches the text that changed, so hovering a button
 * survives the keystroke that re-counts the words.
 *
 * It reads as an editor's status bar: monospace, one field after another,
 * each behind a hairline. The save state in words comes first — saved,
 * saving, and in red, staying until it is true no more, not saved — then the
 * view, where the caret is, and the counts. Shortcut hints do not live here,
 * they are in the `?` sheet.
 *
 * Delete asks for a second press on the button itself, which
 * turns red to say so. Once it has gone through, the status offers "undo",
 * and a line along the footer's top edge runs down the seconds it lasts.
 *
 * The status line changes on every keystroke, which would make it a very
 * talkative live region. Notices — copied, deleted, restored — are also
 * written to a hidden `role="status"` element, so a screen reader hears those
 * and not the word count.
 */
import type { State } from './store.ts';
import { UNDO_WINDOW } from './store.ts';
import { keyHints } from './html.ts';
import { compactCount, tokenEstimate, wordCount } from './model.ts';
import { strings } from './strings.ts';
import { effectiveTheme } from './theme.ts';

/**
 * Sun and moon are one drawing: for the moon the core grows and a second
 * circle bites into it, and the rays turn and fold away (`pad.css`). The
 * button shows the theme it switches to, as its words used to.
 */
const THEME_ICON = `<svg class="theme-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
  <mask id="theme-icon-bite"><rect width="24" height="24" fill="#fff"/><circle class="theme-icon__bite" r="7" fill="#000"/></mask>
  <circle class="theme-icon__core" cx="12" cy="12" fill="currentColor" mask="url(#theme-icon-bite)"/>
  <path class="theme-icon__rays" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M12 2.2v2.1M12 19.7v2.1M2.2 12h2.1M19.7 12h2.1M5.1 5.1l1.5 1.5M17.4 17.4l1.5 1.5M5.1 18.9l1.5-1.5M17.4 6.6l1.5-1.5"/>
</svg>`;

/** How long a button says what it just did. */
const ACK_TIME = 1500;

export interface Footer {
  paint(state: State, text: string): void;
  /**
   * The button that was used says it worked, where the eye already is, and the
   * screen reader hears `message`.
   */
  acknowledge(action: 'copy' | 'export', message: string): void;
  /** Where the caret is; `null` where there is none, as in the reading view. */
  position(at: { line: number; column: number } | null): void;
}

export function createFooter(root: HTMLElement): Footer {
  root.innerHTML = `
    <span class="footer__timer" aria-hidden="true"></span>
    <div class="footer__status">
      <span class="footer__text"></span>
      <span class="footer__keys"></span>
      <button type="button" class="footer__action" data-action="undo" hidden>${strings.undo}</button>
      <span class="footer__count"><span class="footer__field footer__mode"></span><span class="footer__field footer__position"></span><span class="footer__field footer__words"></span><span class="footer__field footer__tokens"></span></span>
      <span class="visually-hidden" role="status"></span>
    </div>
    <div class="footer__actions">
      <button type="button" class="footer__action" data-action="copy">${strings.copy}</button>
      <button type="button" class="footer__action" data-action="export">${strings.export}</button>
      <button type="button" class="footer__action" data-action="delete">${strings.delete}</button>
      <span class="footer__sep" aria-hidden="true"></span>
      <button type="button" class="footer__action footer__theme" data-action="theme">${THEME_ICON}</button>
    </div>`;

  const timer = root.querySelector<HTMLElement>('.footer__timer')!;
  const status = root.querySelector<HTMLElement>('.footer__text')!;
  const count = root.querySelector<HTMLElement>('.footer__count')!;
  const words = root.querySelector<HTMLElement>('.footer__words')!;
  const tokens = root.querySelector<HTMLElement>('.footer__tokens')!;
  const mode = root.querySelector<HTMLElement>('.footer__mode')!;
  const where = root.querySelector<HTMLElement>('.footer__position')!;
  const keys = root.querySelector<HTMLElement>('.footer__keys')!;
  let keysFor = '';
  const announce = root.querySelector<HTMLElement>('[role="status"]')!;
  const undo = root.querySelector<HTMLElement>('[data-action="undo"]')!;
  const remove = root.querySelector<HTMLElement>('[data-action="delete"]')!;
  const theme = root.querySelector<HTMLElement>('[data-action="theme"]')!;
  timer.style.animationDuration = `${UNDO_WINDOW}ms`;

  let countedFor: string | null = null;
  let countdownFor = 0;
  const acks = new Map<HTMLElement, number>();

  // Reading has no caret; `paint` keeps this for `position`.
  let reading = false;
  const setText = (el: HTMLElement, value: string) => {
    if (el.textContent !== value) el.textContent = value;
  };

  return {
    paint(state, text) {
      const failed = state.saveFailed || state.loadFailed;
      status.classList.toggle('is-failed', failed && !state.status);

      // An empty draft has nothing to have saved, so it says what it is. A
      // disk that could not be read outranks the rest: the drafts on it are
      // not on screen, and only a reload brings them.
      const saveState = state.loadFailed
        ? strings.loadFailed
        : state.saveFailed
          ? strings.saveFailed
          : state.saving
            ? strings.saving
            : text.trim()
              ? strings.saved
              : strings.empty;
      setText(
        status,
        state.pendingDelete
          ? strings.deleteAsk
          : state.status || (state.deleted ? strings.deleted : saveState),
      );

      // The keys that answer what the status asks, as key caps beside it —
      // in front of what they do, like every hint: `↵ delete`, `esc undo`.
      const keyHtml = state.pendingDelete
        ? keyHints(strings.deleteKeys)
        : state.deleted && !state.status && strings.undoKey
          ? `<kbd>${strings.undoKey}</kbd>`
          : '';
      if (keyHtml !== keysFor) {
        keysFor = keyHtml;
        keys.innerHTML = keyHtml;
      }

      // Counting is a pass over the whole draft; skip it when nothing changed.
      if (text !== countedFor) {
        countedFor = text;
        const has = !!text.trim();
        setText(words, has ? strings.words(wordCount(text)) : '');
        setText(tokens, has ? strings.tokens(compactCount(tokenEstimate(text))) : '');
        // An empty draft has nothing to count, and no field to draw for it.
        words.hidden = !has;
        tokens.hidden = !has;
      }
      setText(mode, strings.modeLabel[state.mode]);
      reading = state.mode === 'read';
      // Reading has no caret.
      where.hidden = state.mode === 'read' || !where.textContent;
      // A question or a notice in the status takes the room the fields had.
      count.hidden = state.pendingDelete || state.deleted || !!state.status;

      const notice = state.pendingDelete
        ? strings.deleteConfirm
        : state.status ||
          (state.deleted
            ? strings.deletedSpoken
            : state.loadFailed
              ? strings.loadFailed
              : state.saveFailed
                ? strings.saveFailed
                : '');
      if (announce.textContent !== notice) announce.textContent = notice;

      undo.hidden = !state.deleted || state.pendingDelete || !!state.status;

      remove.classList.toggle('is-armed', state.pendingDelete);
      setText(remove, state.pendingDelete ? strings.deleteArmed : strings.delete);

      // Restarted for each delete, not just on the first: a second one inside
      // the window gets the whole window again.
      if (state.deleted && state.deletedAt !== countdownFor) {
        countdownFor = state.deletedAt;
        timer.classList.remove('is-running');
        void timer.offsetWidth;
        timer.classList.add('is-running');
      } else if (!state.deleted) {
        countdownFor = 0;
        timer.classList.remove('is-running');
      }

      // The button draws the theme it switches to; its name says so in words.
      const toDark = effectiveTheme(state.theme) === 'light';
      theme.classList.toggle('is-moon', toDark);
      // Drawn in place on the first paint; it turns from one to the other only
      // once the page is on screen.
      if (!theme.classList.contains('is-ready'))
        requestAnimationFrame(() => theme.classList.add('is-ready'));
      const label = strings.themeSwitch(toDark ? strings.themeDark : strings.themeLight);
      if (theme.title !== label) {
        theme.title = label;
        theme.setAttribute('aria-label', label);
      }
    },

    position(at) {
      setText(where, at ? strings.position(at.line, at.column) : '');
      where.hidden = !at || reading;
    },

    acknowledge(action, message) {
      const button = root.querySelector<HTMLElement>(`[data-action="${action}"]`)!;
      const label = action === 'copy' ? strings.copy : strings.export;
      clearTimeout(acks.get(button));
      button.textContent =
        action === 'copy' ? strings.copiedButton : strings.exportedButton;
      button.classList.add('is-done');
      announce.textContent = message;
      acks.set(
        button,
        window.setTimeout(() => {
          button.textContent = label;
          button.classList.remove('is-done');
        }, ACK_TIME),
      );
    },
  };
}
