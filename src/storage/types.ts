/**
 * Persistence contract. The UI layer talks to this and never to IndexedDB
 * directly — that is what keeps disk, sync or per-language blocks possible
 * later without a painful migration.
 */

export const SCHEMA_VERSION = 1;

export interface Draft {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
  /** Caret offset, so reopening a tab lands where the writing stopped. */
  caret?: number;
  /**
   * How far down the reading view was, as a fraction of what scrolls, so a
   * long answer reopens where the reading stopped. A fraction rather than
   * pixels, because the same draft is taller in a narrower window.
   */
  scroll?: number;
}

export interface DraftStore {
  /** Every draft, newest change first. */
  all(): Promise<Draft[]>;
  /**
   * Writes the draft, unless the disk already holds a newer change to it:
   * a tab saving only its caret must not put its older text back over the
   * text another tab has just written.
   */
  put(draft: Draft): Promise<void>;
  remove(id: string): Promise<void>;
}

export type ThemeChoice = 'system' | 'dark' | 'light';

/** The reading view's typeface: the system sans, or a serif for long reads. */
export type ReadingFont = 'sans' | 'serif';

export interface Prefs {
  activeId: string | null;
  theme: ThemeChoice;
  readingFont: ReadingFont;
  /** Numbers in the source's margin, as a code editor has them. */
  lineNumbers: boolean;
  /**
   * How wide focus holds the text, in pixels, as the writer dragged it;
   * `null` for the reading measure.
   */
  focusWidth: number | null;
  /**
   * A version just updated to, whose news the footer offers for one session.
   * The service worker sets it; the page clears it as soon as it has read it.
   */
  whatsNew: string | null;
  /** When every draft was last backed up into a `.zip`; `null` for never. */
  lastBackup: number | null;
}

export interface PrefsStore {
  read(): Promise<Partial<Prefs>>;
  write(prefs: Partial<Prefs>): Promise<void>;
}

/**
 * What one scratchpad tab tells the others. The toolbar reuses its tab, but a
 * duplicated tab or a pasted address still makes two, and each would otherwise
 * write its own stale copy over the other's newer text.
 */
export type DraftEvent =
  | { type: 'put'; draft: Draft }
  /**
   * `ifEmpty` marks a draft cleared away for being empty rather than deleted
   * by the writer. Another tab may already be typing into it, so there it
   * goes only if it is still empty there too.
   */
  | { type: 'remove'; id: string; ifEmpty?: boolean };

export interface DraftSync {
  /** Sent once the change is on the disk, so a reload never undoes it. */
  publish(event: DraftEvent): void;
  subscribe(handler: (event: DraftEvent) => void): void;
}
