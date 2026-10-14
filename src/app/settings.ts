/**
 * The settings panel, laid over the editor the way search is: backup and
 * restore first, since they are what keeps the drafts safe, then the Markdown
 * export, the theme, and what the extension is.
 *
 * A restore never happens straight from the file. Reading a backup only
 * shows what it would do — so many new, so many newer than the copy here, so
 * many already here — and the writer says yes. The page holds that pending
 * restore and passes it in; this module only draws it.
 *
 * The HTML is rebuilt only when it would differ, like the rail's.
 */
import type { Backup } from './backup.ts';
import { backupLabel } from './backup.ts';
import type { ImportPreview, State } from './store.ts';
import { withKey } from './html.ts';
import { strings } from './strings.ts';

/** A backup that was read and waits for the writer's yes. */
export interface PendingRestore {
  backup: Backup;
  preview: ImportPreview;
}

const CHANGELOG_URL =
  'https://github.com/m4rcone/scratchpad-newtab/blob/main/CHANGELOG.md';
const PRIVACY_URL = 'https://github.com/m4rcone/scratchpad-newtab/blob/main/PRIVACY.md';
const SUPPORT_URL = 'https://ko-fi.com/m4rcone';

/**
 * The review link carries a star, on the toolbar's 48-unit grid and 4-unit
 * stroke. The part tagged `fill` fills in on hover.
 */
const linkIcon = (body: string) =>
  `<svg class="settings__icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 48 48" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const STAR = linkIcon(
  '<path class="fill" d="M24 5.5l5.1 13 13.9.8-10.8 8.9 3.6 13.5L24 34.1l-11.8 7.6 3.6-13.5L5 19.3l13.9-.8Z"/>',
);

const link = (href: string, label: string, icon = '') =>
  `<a class="settings__link" href="${href}" target="_blank" rel="noopener noreferrer">${icon}${label}</a>`;

function restoreCard(pending: PendingRestore): string {
  const { backup, preview } = pending;
  const date = new Date(backup.createdAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const changes = preview.added + preview.updated;
  return `<div class="settings__restore" role="group" aria-label="${strings.restoreButton}">
      <p>${strings.restoreFrom(date, backup.drafts.length)}
        ${changes ? strings.restoreWould(preview.added, preview.updated, preview.same) : strings.restoreNothing}</p>
      <div class="settings__row">
        ${changes ? `<button type="button" class="settings__button is-primary" data-action="restore-confirm">${strings.restoreConfirm}</button>` : ''}
        <button type="button" class="settings__button" data-action="restore-cancel">${strings.restoreCancel}</button>
      </div>
    </div>`;
}

/**
 * `storeId` is the extension's own id, which for a copy installed from the
 * Chrome Web Store is its id there too: the review link is built from it.
 * Empty outside the extension, where the link is left out.
 */
export function createSettings(
  root: HTMLElement,
  version: string,
  storeId: string,
): (state: State, pending: PendingRestore | null) => void {
  let last = '';

  return (state, pending) => {
    if (!state.settingsOpen) return;
    const backup = backupLabel(state.lastBackup, state.drafts);
    const theme = (value: 'system' | 'light' | 'dark', label: string) =>
      `<button type="button" data-action="theme" data-theme-choice="${value}" aria-pressed="${state.theme === value}">${label}</button>`;

    const html = `
      <div class="settings__col">
        <div class="settings__head">
          <h1 class="settings__title">${strings.settingsTitle}</h1>
          <button type="button" class="settings__close" data-action="close">${withKey(strings.escKey, strings.close)}</button>
        </div>

        <section class="settings__section" aria-labelledby="settings-backup">
          <h2 id="settings-backup">${strings.backupTitle}</h2>
          ${backup ? `<p class="settings__status">${backup}</p>` : ''}
          <p>${strings.backupExplain}</p>
          <div class="settings__row">
            <button type="button" class="settings__button is-primary" data-action="backup">${strings.backupNowButton}</button>
            <button type="button" class="settings__button" data-action="restore">${strings.restoreButton}</button>
          </div>
          ${pending ? restoreCard(pending) : ''}
        </section>

        <section class="settings__section" aria-labelledby="settings-export">
          <h2 id="settings-export">${strings.exportTitle}</h2>
          <p>${strings.exportExplain}</p>
          <div class="settings__row">
            <button type="button" class="settings__button" data-action="export-all">${strings.exportAllButton}</button>
            <button type="button" class="settings__button" data-action="open-files">${strings.openFilesButton}</button>
          </div>
        </section>

        <section class="settings__section" aria-labelledby="settings-theme">
          <h2 id="settings-theme">${strings.appearanceTitle}</h2>
          <div class="settings__segments" role="group" aria-labelledby="settings-theme">
            ${theme('system', strings.themeSystem)}${theme('light', strings.themeLight)}${theme('dark', strings.themeDark)}
          </div>
        </section>

        <section class="settings__section" aria-labelledby="settings-about">
          <h2 id="settings-about">${strings.aboutTitle}</h2>
          <p class="settings__status">${version ? strings.version(version) : strings.appName}${
            state.whatsNew
              ? ` <span class="news-flag settings__new">${strings.newsFlag}</span>`
              : ''
          }</p>
          <p>${strings.aboutPrivacy}</p>
          <div class="settings__row">
            ${link(CHANGELOG_URL, strings.changelogLink)}
            ${link(PRIVACY_URL, strings.privacyLink)}
            ${storeId ? link(`https://chromewebstore.google.com/detail/${storeId}/reviews`, strings.reviewLink, STAR) : ''}
            ${link(SUPPORT_URL, strings.supportLink)}
          </div>
        </section>
      </div>`;
    if (html === last) return;
    last = html;
    // A rebuild must not throw the keyboard out: whatever button had focus
    // gets it back in the new markup.
    const focused = root.contains(document.activeElement)
      ? (document.activeElement as HTMLElement)
      : null;
    const key = focused?.dataset.themeChoice ?? focused?.dataset.action;
    root.innerHTML = html;
    if (key) {
      root
        .querySelector<HTMLElement>(
          `[data-theme-choice="${key}"], [data-action="${key}"]:not([data-theme-choice])`,
        )
        ?.focus();
    }
  };
}
