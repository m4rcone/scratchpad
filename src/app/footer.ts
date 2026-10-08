/**
 * Status on the left, the four actions on the right. The buttons are built
 * once; every paint only touches the text that changed, so hovering a button
 * survives the keystroke that re-counts the words.
 *
 * After an update worth mentioning, a "what's new" link leads the actions for
 * one session. Delete asks for a second press. Once it has gone through, the button turns
 * into "undo" for a few seconds: the pointer that deleted is already on it.
 */
import type { State } from './store.ts';
import { wordCount } from './model.ts';
import { shortVersion } from './release.ts';
import { strings } from './strings.ts';
import { effectiveTheme } from './theme.ts';

/**
 * Where an update's news lives. A link the writer may follow, opened in a tab
 * of its own; nothing is ever fetched from it.
 */
const CHANGELOG_URL =
  'https://github.com/m4rcone/scratchpad-newtab/blob/main/CHANGELOG.md';

const MODE_STATUS = {
  write: strings.saved,
  split: strings.splitting,
  read: strings.reading,
};

export function createFooter(root: HTMLElement): (state: State, text: string) => void {
  root.innerHTML = `
    <div class="footer__status"></div>
    <div class="footer__actions">
      <a class="footer__action" data-action="news" href="${CHANGELOG_URL}" target="_blank" rel="noopener noreferrer" hidden></a>
      <button type="button" class="footer__action" data-action="copy">${strings.copy}</button>
      <button type="button" class="footer__action" data-action="export">${strings.export}</button>
      <button type="button" class="footer__action" data-action="delete">${strings.delete}</button>
      <button type="button" class="footer__action" data-action="theme"></button>
    </div>`;

  const status = root.querySelector<HTMLElement>('.footer__status')!;
  const remove = root.querySelector<HTMLElement>('[data-action="delete"]')!;
  const theme = root.querySelector<HTMLElement>('[data-action="theme"]')!;
  const news = root.querySelector<HTMLElement>('[data-action="news"]')!;

  return (state, text) => {
    status.textContent = state.pendingDelete
      ? strings.deleteConfirm
      : state.status ||
        (state.deleted
          ? strings.deleted
          : `${strings.words(wordCount(text))} · ${state.saving ? strings.saving : MODE_STATUS[state.mode]}`);
    news.hidden = !state.whatsNew;
    if (state.whatsNew) news.textContent = strings.whatsNew(shortVersion(state.whatsNew));
    remove.classList.toggle('is-armed', state.pendingDelete);
    remove.dataset.action = state.deleted ? 'undo' : 'delete';
    remove.textContent = state.deleted ? strings.undo : strings.delete;
    theme.textContent =
      effectiveTheme(state.theme) === 'dark' ? strings.themeLight : strings.themeDark;
  };
}
