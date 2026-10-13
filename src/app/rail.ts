/**
 * The side rail: drafts grouped by day, newest first. On a narrow screen the
 * same markup is an overlay, opened from the top bar and closed from its foot.
 * The open draft is tinted; whether it is saved is the footer's to say. The
 * foot leads with "new draft" and
 * ends with the way into settings, flagged in red when a backup is overdue.
 * The HTML is rebuilt only when it would differ: a keystroke that does not
 * change a title leaves the DOM alone. The logo sits at its head, in the
 * rail's own dimmed ink, so it follows the theme without a second file.
 */
import type { State } from './store.ts';
import logo from './logo.svg?raw';
import { backupStatus } from './backup.ts';
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
            const on = draft.id === state.activeId;
            const active = on ? ' is-active' : '';
            const current = on ? ' aria-current="true"' : '';
            const title = titleOf(draft.text) || strings.untitled;
            return `<button type="button" class="rail__row${active}"${current} data-id="${escapeHtml(draft.id)}">
              <span class="rail__title"><span class="rail__name">${escapeHtml(title)}</span></span>
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

    // The foot is three actions, one per line, each with what it does on the
    // left and its key — or what it has to say — on the right. Settings is
    // where the backup lives, so an overdue one is flagged on the way in.
    const stale = backupStatus(state.lastBackup, state.drafts)?.stale ?? false;
    const action = (name: string, label: string, aside: string) =>
      `<button type="button" class="rail__action rail__${name}" data-action="${name}"><span>${label}</span>${aside}</button>`;
    const keys = (value: string) =>
      value ? `<kbd class="rail__keys">${value}</kbd>` : '';
    const due = stale
      ? `<span class="rail__due"><span class="rail__due-dot" aria-hidden="true"></span>${strings.backupDue}</span>`
      : '';
    // An update's news is quieter: a dot beside the word, the key kept.
    const news =
      state.whatsNew && !state.settingsOpen
        ? `<span class="rail__news" aria-hidden="true"></span><span class="visually-hidden">, ${strings.newsFlag}</span>`
        : '';

    const html = `
      <div class="rail__head" aria-hidden="true">${logo}</div>
      <div class="rail__list">${groups || `<div class="rail__empty">${strings.railEmpty}</div>`}</div>
      <div class="rail__foot">
        ${action('new', strings.newDraft, keys(strings.newDraftKeys))}
        ${action('search', strings.searchDrafts, keys(strings.searchKeys))}
        ${action('settings', strings.settings + news, due || keys(strings.settingsKeys))}
        <button type="button" class="rail__action rail__close" data-action="close"><span>${strings.close}</span>${keys(strings.escKey)}</button>
      </div>`;
    if (html === last) return;
    last = html;
    root.innerHTML = html;
  };
}
