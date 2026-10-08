/**
 * Status on the left, the four actions on the right. The buttons are built
 * once; every paint only touches the text that changed, so hovering a button
 * survives the keystroke that re-counts the words.
 *
 * Delete asks for a second press. Once it has gone through, the button turns
 * into "undo" for a few seconds: the pointer that deleted is already on it.
 */
import type { State } from './store.ts';
import { wordCount } from './model.ts';
import { strings } from './strings.ts';
import { effectiveTheme } from './theme.ts';

const MODE_STATUS = {
  write: strings.saved,
  split: strings.splitting,
  read: strings.reading,
};

export function createFooter(root: HTMLElement): (state: State, text: string) => void {
  root.innerHTML = `
    <div class="footer__status"></div>
    <div class="footer__actions">
      <button type="button" class="footer__action" data-action="copy">${strings.copy}</button>
      <button type="button" class="footer__action" data-action="export">${strings.export}</button>
      <button type="button" class="footer__action" data-action="delete">${strings.delete}</button>
      <button type="button" class="footer__action" data-action="theme"></button>
    </div>`;

  const status = root.querySelector<HTMLElement>('.footer__status')!;
  const remove = root.querySelector<HTMLElement>('[data-action="delete"]')!;
  const theme = root.querySelector<HTMLElement>('[data-action="theme"]')!;

  return (state, text) => {
    status.textContent = state.pendingDelete
      ? strings.deleteConfirm
      : state.status ||
        (state.deleted
          ? strings.deleted
          : `${strings.words(wordCount(text))} · ${state.saving ? strings.saving : MODE_STATUS[state.mode]}`);
    remove.classList.toggle('is-armed', state.pendingDelete);
    remove.dataset.action = state.deleted ? 'undo' : 'delete';
    remove.textContent = state.deleted ? strings.undo : strings.delete;
    theme.textContent =
      effectiveTheme(state.theme) === 'dark' ? strings.themeLight : strings.themeDark;
  };
}
