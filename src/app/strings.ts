/**
 * Every piece of UI copy lives here, so translating is a one-file change.
 * Shortcut labels follow the OS, and disappear where there is no keyboard.
 */
import { isMac, isTouch, shortcut } from './platform.ts';

const hint = (key: string, shift = false) => (isTouch ? '' : ` ${shortcut(key, shift)}`);
/** Enter as the platform writes it in a chord: `⌘⇧↵`, `Ctrl+Shift+Enter`. */
const ENTER = isMac ? '↵' : 'Enter';

export const strings = {
  emptyHint: 'write, paste or drop a file',
  untitled: 'untitled',
  now: 'now',
  today: 'today',
  yesterday: 'yesterday',
  earlier: 'earlier',
  newDraft: 'new draft',
  newDraftKeys: isTouch ? '' : shortcut('D', true),
  searchDrafts: 'search drafts',
  searchKeys: isTouch ? '' : shortcut('F', true),
  railEmpty: 'no drafts yet',
  draftsButton: 'drafts',
  viewWrite: 'write',
  viewSplit: 'split',
  viewRead: 'read',
  viewWriteTitle: 'text only',
  viewSplitTitle: `text and preview${hint('/')}`,
  viewReadTitle: `preview only${hint('P', true)}`,
  focusTitle: `focus: the text alone${hint(ENTER, true)}`,
  /** In the corner while focus is on; escape or a click leaves it. */
  focusExit: 'leave focus',
  focusWidthTitle: 'drag to set the width; double-click for the default',
  /** The footer's view, in its own words. */
  modeLabel: { write: 'write', split: 'split', read: 'read' },
  position: (line: number, column: number) => `Ln ${line}, Col ${column}`,
  toolbarLabel: 'formatting and views',
  /**
   * Written between a format's markers where there is no word to wrap, and
   * selected to be typed over; keyed by the opening marker.
   */
  formatPlaceholders: {
    '**': 'bold text',
    '*': 'italic text',
    '~~': 'strikethrough',
    '`': 'code',
    $: 'formula',
    '[': 'link text',
  } as Record<string, string>,
  formatPlaceholder: 'text',
  appName: 'Scratchpad',
  close: 'close',
  /** Beside every close: the key that does the same. */
  escKey: isTouch ? '' : 'esc',
  searchPlaceholder: 'search your drafts',
  /** Key and what it does, drawn as key caps rather than run together. */
  searchKeysHelp: [
    ['↑↓', 'move'],
    ['↵', 'open'],
  ] as [string, string][],
  searchCount: (shown: number, total: number) => `${shown} of ${total}`,
  searchEmpty: 'nothing matches',
  words: (count: number) =>
    `${count.toLocaleString('en-US')} ${count === 1 ? 'word' : 'words'}`,
  tokens: (count: string) => `~${count} tokens`,
  saved: 'saved',
  /** A draft with nothing in it: there is nothing to have saved. */
  empty: 'empty',
  saving: 'saving…',
  saveFailed: 'not saved, retrying',
  loadFailed: 'could not read your drafts, reload the tab',
  copy: 'copy',
  export: 'export',
  delete: 'delete',
  themeDark: 'dark',
  themeLight: 'light',
  themeSwitch: (to: string) => `switch to the ${to} theme`,
  copied: 'copied to the clipboard',
  exported: (name: string) => `exported as ${name}`,
  /** On the delete button while it waits for the second press. */
  deleteArmed: 'confirm delete',
  /** Beside it, in the status, with the keys that answer it. */
  deleteAsk: isTouch ? 'tap again to delete' : 'delete this draft?',
  deleteKeys: isTouch
    ? []
    : ([
        ['↵', 'delete'],
        ['esc', 'keep'],
      ] as [string, string][]),
  copiedButton: 'copied ✓',
  exportedButton: 'exported ✓',
  deleteConfirm: isTouch
    ? 'delete this draft? tap delete again to confirm'
    : 'delete this draft? enter confirms, escape cancels',
  undo: 'undo',
  newsFlag: 'new',
  deleted: 'draft deleted',
  /** Read out with the notice; on screen the key cap says it. */
  deletedSpoken: isTouch ? 'draft deleted' : 'draft deleted, escape brings it back',
  undoKey: isTouch ? '' : 'esc',
  deletedEmpty: 'draft deleted',
  copyCode: 'copy',
  copyCodeLabel: 'copy code',
  codeCopied: 'copied',
  dropOnly: 'only .md and .txt files open here',
  dropToSettings: 'open a .zip or a backup from settings',
  dropped: (count: number) =>
    count === 1 ? 'opened as a draft' : `opened as ${count} drafts`,
  droppedAlready: 'already here: nothing new to open',
  droppedNothing: 'nothing to open: those files are empty',
  restoreFailed: 'that file is not a Scratchpad backup',
  zipFailed: 'could not read that .zip',
  findPlaceholder: 'find',
  replacePlaceholder: 'replace with',
  findPrev: isTouch ? 'previous match' : 'previous match (⇧↵)',
  findNext: isTouch ? 'next match' : 'next match (↵)',
  matchCase: 'match case',
  toggleReplace: 'replace',
  replaceOne: 'replace',
  replaceAll: 'replace all',
  findCount: (at: number, total: number) => (total ? `${at} of ${total}` : 'no matches'),
  replaced: (count: number) => `replaced ${count}`,
  backupNever: 'no backup yet',
  backupOn: (date: string) => `last backup ${date}`,
  settings: 'settings',
  settingsKeys: isTouch ? '' : shortcut(',', true),
  settingsTitle: 'Settings',
  backupTitle: 'Backup',
  backupExplain:
    'Drafts live only in this Chrome profile: uninstalling the extension or clearing its data erases them. A backup is one .json file with every draft, its dates included, to restore here or on another computer.',
  backupNowButton: 'Back up now',
  restoreButton: 'Restore from a backup…',
  backedUp: (name: string) => `backed up as ${name}`,
  backupEmpty: 'nothing to back up yet',
  backupCancelled: 'not backed up',
  backupFileType: 'Scratchpad backup',
  restoreFrom: (date: string, total: number) =>
    `Backup from ${date}, with ${total} ${total === 1 ? 'draft' : 'drafts'}.`,
  restoreWould: (added: number, updated: number, same: number) =>
    [
      added && `${added} new`,
      updated && `${updated} newer than the copy here`,
      same && `${same} already here`,
    ]
      .filter(Boolean)
      .join(', ') + '.',
  restoreNothing: 'Everything in it is already here.',
  restoreConfirm: 'Restore',
  restoreCancel: 'Cancel',
  restored: (added: number, updated: number) => {
    if (!added && !updated) return 'nothing new in that backup';
    const parts = [];
    if (added) parts.push(`${added} ${added === 1 ? 'draft' : 'drafts'} restored`);
    if (updated) parts.push(`${updated} updated`);
    return parts.join(', ');
  },
  exportTitle: 'Markdown',
  exportExplain:
    'Every draft as a .md file, in one .zip, to read or use elsewhere. Each file is dated by its draft’s last change. To bring drafts back whole, use a backup.',
  exportAllButton: 'Export all as Markdown',
  openFilesButton: 'Open .md files…',
  exportedAll: (name: string) => `exported as ${name}`,
  appearanceTitle: 'Appearance',
  themeLabel: 'Theme',
  themeSystem: 'system',
  lineNumbersLabel: 'Line numbers',
  lineNumbersHint: 'In the margin, as in a code editor; not in focus.',
  lineNumbersOff: 'off',
  lineNumbersOn: 'on',
  readingLabel: 'Reading typeface',
  readingHint: 'For the reading view; code stays monospace.',
  readingSans: 'sans',
  readingSerif: 'serif',
  aboutTitle: 'About',
  version: (version: string) => `Scratchpad ${version}`,
  aboutPrivacy: 'No account, no network, no telemetry.',
  changelogLink: 'What’s new',
  privacyLink: 'Privacy',
  reviewLink: 'Review',
  supportLink: 'Support',
  dropTitle: 'drop to open as a new draft',
  dropDetail: ['.md and .txt files'],
  shortcutsTitle: 'Scratchpad',
  /** The `?` sheet's own section; `icon` names a drawing in `editor.ts`. */
  shortcuts: [
    { icon: 'new', label: 'new draft', keys: shortcut('D', true) },
    { icon: 'search', label: 'search drafts', keys: shortcut('F', true) },
    { icon: 'find', label: 'find and replace', keys: shortcut('F') },
    { icon: 'split', label: 'preview beside', keys: shortcut('/') },
    { icon: 'read', label: 'read', keys: shortcut('P', true) },
    { icon: 'focus', label: 'focus', keys: shortcut(ENTER, true) },
    { icon: 'copy', label: 'copy the draft', keys: shortcut('A', true) },
    { icon: 'export', label: 'export as .md', keys: shortcut('S') },
    { icon: 'settings', label: 'settings', keys: shortcut(',', true) },
    { icon: 'open', label: 'open from anywhere', keys: isMac ? '⌥⇧S' : 'Alt+Shift+S' },
  ],
  emptyKeys: [
    [shortcut('/'), 'preview beside'],
    [shortcut('P', true), 'read'],
    [shortcut('F', true), 'search drafts'],
    [shortcut('F'), 'find in this draft'],
  ] as [string, string][],
};
