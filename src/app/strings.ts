/**
 * Every piece of UI copy lives here, so translating is a one-file change.
 * Shortcut labels follow the OS, and disappear where there is no keyboard.
 */
import { isTouch, shortcut } from './platform.ts';

const hint = (key: string, shift = false) => (isTouch ? '' : ` ${shortcut(key, shift)}`);

export const strings = {
  emptyHint: 'write or paste',
  untitled: 'untitled',
  now: 'now',
  today: 'today',
  yesterday: 'yesterday',
  earlier: 'earlier',
  newDraft: `new draft${hint('D', true)}`,
  drafts: (count: number) =>
    `${count} ${count === 1 ? 'draft' : 'drafts'}${isTouch ? ' · search' : ` ·${hint('F', true)}`}`,
  railEmpty: 'no drafts yet',
  draftsButton: 'drafts',
  splitView: 'split view',
  writeOnly: 'write only',
  splitToggle: `preview beside${hint('/')}`,
  readToggle: `read${hint('P', true)}`,
  support: 'support on ko-fi',
  appName: 'Scratchpad',
  close: 'close',
  searchPlaceholder: 'search your drafts',
  searchHelp: '↑↓ move · enter open · esc close',
  searchCount: (shown: number, total: number) => `${shown} of ${total}`,
  searchEmpty: 'nothing matches',
  words: (count: number) => `${count} ${count === 1 ? 'word' : 'words'}`,
  saved: isTouch ? 'saved' : `saved ·${hint('/')} splits the preview`,
  saving: 'saving…',
  saveFailed: 'could not save · still trying',
  splitting: isTouch ? 'split view' : `split view ·${hint('/')} closes it`,
  reading: isTouch ? 'reading' : `reading ·${hint('P', true)} or esc returns`,
  copy: 'copy',
  export: 'export',
  delete: 'delete',
  themeDark: 'dark',
  themeLight: 'light',
  copied: 'copied to the clipboard',
  exported: (name: string) => `exported as ${name}`,
  deleteConfirm: isTouch
    ? 'delete this draft? tap delete again to confirm'
    : 'delete this draft? enter confirms · esc cancels',
  undo: 'undo',
  deleted: isTouch ? 'draft deleted' : 'draft deleted · esc brings it back',
  deletedEmpty: 'draft deleted',
  copyCode: 'copy',
  codeCopied: 'copied',
  dropOnly: 'only .md and .txt files open as drafts',
  dropped: (count: number) =>
    count === 1 ? 'opened as a draft' : `opened as ${count} drafts`,
};
