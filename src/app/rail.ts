/**
 * The side rail: drafts grouped by day, newest first. On a narrow screen the
 * same markup is an overlay, opened from the top bar and closed from its foot.
 * The HTML is rebuilt only when it would differ: a keystroke that does not
 * change a title leaves the DOM alone. The logo sits at its head, in the
 * rail's own dimmed ink, so it follows the theme without a second file.
 */
import type { State } from './store.ts';
import logo from './logo.svg?raw';
import { escapeHtml } from './html.ts';
import { groupByDay, timeLabel, titleOf } from './model.ts';
import { strings } from './strings.ts';

const LABELS: Record<string, string> = {
  today: strings.today,
  yesterday: strings.yesterday,
  earlier: strings.earlier,
};

export function createRail(root: HTMLElement): (state: State) => void {
  let last = '';

  return (state) => {
    root.classList.toggle('is-open', state.railOpen);
    if (!state.loaded) return;

    const groups = groupByDay(state.drafts)
      .map((group) => {
        const rows = group.drafts
          .map((draft) => {
            const active = draft.id === state.activeId ? ' is-active' : '';
            const title = titleOf(draft.text) || strings.untitled;
            return `<button type="button" class="rail__row${active}" data-id="${draft.id}">
              <span class="rail__title">${escapeHtml(title)}</span>
              <span class="rail__time">${escapeHtml(timeLabel(draft.updatedAt))}</span>
            </button>`;
          })
          .join('');
        return `<div class="rail__group">
          <div class="rail__label">${LABELS[group.label] ?? group.label}</div>
          ${rows}
        </div>`;
      })
      .join('');

    const html = `
      <div class="rail__head" aria-hidden="true">${logo}</div>
      <div class="rail__list">${groups || `<div class="rail__empty">${strings.railEmpty}</div>`}</div>
      <div class="rail__foot">
        <button type="button" class="rail__action" data-action="new">${strings.newDraft}</button>
        <button type="button" class="rail__action" data-action="search">${strings.drafts(state.drafts.length)}</button>
        <button type="button" class="rail__action rail__close" data-action="close">${strings.close}</button>
      </div>`;
    if (html === last) return;
    last = html;
    root.innerHTML = html;
  };
}
