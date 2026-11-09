/**
 * The side rail: drafts grouped by day, newest first. On a narrow screen the
 * same markup is an overlay, opened from the top bar and closed from its foot.
 * The open draft is tinted; whether it is saved is the footer's to say.
 * "New draft", the one action the rail is for, sits at the top under the logo
 * and the name; the foot holds search and the way into settings.
 * The HTML is rebuilt only when it would differ: a keystroke that does not
 * change a title leaves the DOM alone.
 *
 * Each row's time gives way to a pencil under the pointer or the keyboard
 * (`pad.css`); the pencil, or a double click on the row, turns its title into
 * a field for a name. While the field is open the rail is not rebuilt, so
 * nothing — a tab syncing, the clock turning "now" into "14:32" — takes away
 * what is being typed. The logo sits at its head, in the
 * rail's own dimmed ink, so it follows the theme without a second file.
 */
import type { State } from './store.ts';
import logo from './logo.svg?raw';
import { escapeHtml } from './html.ts';
import { draftTitle, groupByDay, NAME_LENGTH, timeLabel, titleOf } from './model.ts';
import { strings } from './strings.ts';

/** A pencil on the rail's 16px grid, stroked in the text's ink. */
const PENCIL = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 2.5l3 3L5.5 13.5H2.5v-3z"/><path d="M9 4l3 3"/></svg>`;

const LABELS: Record<string, string> = {
  today: strings.today,
  yesterday: strings.yesterday,
  earlier: strings.earlier,
};

export function createRail(root: HTMLElement): (state: State) => void {
  let last = '';
  let lastActive: string | null = null;
  /**
   * A press is under way in the rail. Rebuilding then would take away the
   * button being pressed, and its click with it — which is what leaving the
   * rename field by clicking another row did, the rename's repaint landing
   * between the press and the release. The repaint waits for the release,
   * and runs after the click it ends.
   */
  let pressed = false;
  let waiting: State | null = null;
  root.addEventListener('pointerdown', () => (pressed = true));
  const release = () => {
    if (!pressed) return;
    pressed = false;
    setTimeout(() => {
      const state = waiting;
      waiting = null;
      if (state) paint(state);
    });
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  const paint = (state: State) => {
    root.classList.toggle('is-open', state.railOpen);
    if (!state.loaded) return;
    if (pressed) {
      waiting = state;
      return;
    }
    const field = root.querySelector<HTMLInputElement>('.rail__input');
    if (state.renaming && field?.dataset.rename === state.renaming) return;

    const groups = groupByDay(state.drafts)
      .map((group) => {
        const rows = group.drafts
          .map((draft) => {
            const id = escapeHtml(draft.id);
            if (draft.id === state.renaming) {
              const own = titleOf(draft.text);
              // Holds the name if there is one, the title to edit if not; the
              // placeholder is the title an emptied field goes back to.
              return `<div class="rail__item is-renaming">
                <input class="rail__input" type="text" data-rename="${id}"
                       value="${escapeHtml(draft.name ?? own)}"
                       placeholder="${escapeHtml(own || strings.untitled)}" maxlength="${NAME_LENGTH}"
                       spellcheck="false" autocomplete="off" aria-label="${strings.renameField}" />
              </div>`;
            }
            const on = draft.id === state.activeId;
            const active = on ? ' is-active' : '';
            const current = on ? ' aria-current="true"' : '';
            const title = escapeHtml(draftTitle(draft) || strings.untitled);
            return `<div class="rail__item${active}">
              <button type="button" class="rail__row${active}"${current} data-id="${id}">
                <span class="rail__title"><span class="rail__name">${title}</span></span>
                <span class="rail__time">${escapeHtml(timeLabel(draft.updatedAt))}</span>
              </button>
              <button type="button" class="rail__rename" data-action="rename" data-id="${id}"
                      title="${strings.rename}" aria-label="${strings.renameLabel(title)}">${PENCIL}</button>
            </div>`;
          })
          .join('');
        return `<div class="rail__group">
          <div class="rail__label">${LABELS[group.label] ?? group.label}</div>
          ${rows}
        </div>`;
      })
      .join('');

    // Each action is one line: what it does on the left, its key on the right.
    const action = (name: string, label: string, aside: string) =>
      `<button type="button" class="rail__action rail__${name}" data-action="${name}"><span>${label}</span>${aside}</button>`;
    const keys = (value: string) =>
      value ? `<kbd class="rail__keys">${value}</kbd>` : '';
    // An update's news is quieter: a dot beside the word, the key kept.
    const news =
      state.whatsNew && !state.settingsOpen
        ? `<span class="rail__news" aria-hidden="true"></span><span class="visually-hidden">, ${strings.newsFlag}</span>`
        : '';

    const html = `
      <div class="rail__head" aria-hidden="true">${logo}<span class="rail__name-mark">${strings.appName}</span></div>
      <div class="rail__create">
        <button type="button" class="rail__new" data-action="new"><span>${strings.newDraft}</span>${keys(strings.newDraftKeys)}</button>
      </div>
      <div class="rail__list">${groups || `<div class="rail__empty">${strings.railEmpty}</div>`}</div>
      <div class="rail__foot">
        ${action('search', strings.searchDrafts, keys(strings.searchKeys))}
        ${action('settings', strings.settings + news, keys(strings.settingsKeys))}
        <button type="button" class="rail__action rail__close" data-action="close"><span>${strings.close}</span>${keys(strings.escKey)}</button>
      </div>`;
    if (html === last) return;
    last = html;
    // Rebuilding the markup makes a new list, scrolled to its top: opening a
    // draft near the bottom would throw the writer back up. The list keeps
    // where it was, and moves only as far as it takes to show a draft that
    // became the open one elsewhere — a new one, or one picked in search.
    const scrolled = root.querySelector<HTMLElement>('.rail__list')?.scrollTop ?? 0;
    root.innerHTML = html;
    const list = root.querySelector<HTMLElement>('.rail__list');
    if (!list) return;
    list.scrollTop = scrolled;
    if (state.activeId !== lastActive) revealActive(list);
    lastActive = state.activeId;
    const input = list.querySelector<HTMLInputElement>('.rail__input');
    if (input) {
      input.focus();
      input.select();
    }
  };
  return paint;
}

/** How far a revealed row stays from the list's edge: the shadow's depth. */
const CLEAR = 16;

/**
 * The open draft's row brought into the list's view, the least distance that
 * does it. Done by hand: `scrollIntoView` would also scroll the rail itself,
 * which clips its overflow rather than scrolling it.
 */
function revealActive(list: HTMLElement): void {
  const row = list.querySelector<HTMLElement>('.rail__item.is-active');
  if (!row) return;
  // The first row of a group is shown with its label, and the first group
  // with the space above it: a new draft lands the list back at its top.
  const group = row.parentElement!;
  const first = row.previousElementSibling?.classList.contains('rail__label');
  // Elsewhere the row is kept a little clear of the edge, out from under the
  // shadow that says the list goes on.
  const top =
    first && group === list.firstElementChild
      ? 0
      : (first ? group : row).offsetTop - list.offsetTop - CLEAR;
  const bottom = row.offsetTop - list.offsetTop + row.offsetHeight + CLEAR;
  if (top < list.scrollTop) list.scrollTop = Math.max(0, top);
  else if (bottom > list.scrollTop + list.clientHeight)
    list.scrollTop = bottom - list.clientHeight;
}
