/**
 * Preferences live in `chrome.storage.local`: a handful of small values that
 * have to be there on the very first frame. Outside the extension (vite dev)
 * it falls back to localStorage so the page still runs.
 */
import type { Prefs, PrefsStore, ReadingFont, ThemeChoice } from './types.ts';

const KEY = 'scratchpad.prefs.v1';

const THEMES: ThemeChoice[] = ['system', 'dark', 'light'];
const READING_FONTS: ReadingFont[] = ['sans', 'serif'];

/** The narrowest column focus can be dragged to, and kept at. */
export const MIN_FOCUS_WIDTH = 240;

function sanitize(raw: unknown): Partial<Prefs> {
  if (!raw || typeof raw !== 'object') return {};
  const value = raw as Record<string, unknown>;
  const prefs: Partial<Prefs> = {};
  if (typeof value.activeId === 'string' || value.activeId === null) {
    prefs.activeId = value.activeId as string | null;
  }
  if (THEMES.includes(value.theme as ThemeChoice))
    prefs.theme = value.theme as ThemeChoice;
  if (READING_FONTS.includes(value.readingFont as ReadingFont))
    prefs.readingFont = value.readingFont as ReadingFont;
  if (typeof value.lineNumbers === 'boolean') prefs.lineNumbers = value.lineNumbers;
  if (
    value.focusWidth === null ||
    (typeof value.focusWidth === 'number' &&
      value.focusWidth >= MIN_FOCUS_WIDTH &&
      value.focusWidth <= 4000)
  ) {
    prefs.focusWidth = value.focusWidth as number | null;
  }
  if (typeof value.whatsNew === 'string' || value.whatsNew === null) {
    prefs.whatsNew = value.whatsNew as string | null;
  }
  if (Number.isFinite(value.lastBackup) || value.lastBackup === null) {
    prefs.lastBackup = value.lastBackup as number | null;
  }
  return prefs;
}

const hasChromeStorage = () => typeof chrome !== 'undefined' && !!chrome.storage?.local;

export function prefsStore(): PrefsStore {
  async function read(): Promise<Partial<Prefs>> {
    try {
      if (hasChromeStorage()) return sanitize((await chrome.storage.local.get(KEY))[KEY]);
      const raw = localStorage.getItem(KEY);
      return raw ? sanitize(JSON.parse(raw)) : {};
    } catch {
      return {};
    }
  }

  // Writes read-merge-write, so two in flight would drop one another's
  // change. They queue instead.
  let queue: Promise<void> = Promise.resolve();

  return {
    read,
    write(prefs) {
      queue = queue.then(async () => {
        try {
          const merged = { ...(await read()), ...prefs };
          if (hasChromeStorage()) await chrome.storage.local.set({ [KEY]: merged });
          else localStorage.setItem(KEY, JSON.stringify(merged));
        } catch {
          /* a full or unavailable profile must never break typing */
        }
      });
      return queue;
    },
  };
}
